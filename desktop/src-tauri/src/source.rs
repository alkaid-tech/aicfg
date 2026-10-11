use crate::{domain::*, files::*};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub skill: Skill,
    pub markdown: String,
}
pub struct Discovery {
    pub candidates: Vec<Candidate>,
    pub directory: Checkout,
}

/// Clones are temporary acquisition data, never retained version history.
pub struct Checkout(tempfile::TempDir);
impl AsRef<Path> for Checkout {
    fn as_ref(&self) -> &Path {
        self.0.path()
    }
}
impl std::ops::Deref for Checkout {
    type Target = Path;
    fn deref(&self) -> &Path {
        self.0.path()
    }
}

pub fn normalize_source(source: &str) -> Result<String> {
    if Path::new(source).is_absolute() && Path::new(source).is_dir() {
        return Ok(Path::new(source)
            .canonicalize()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into());
    }
    let value = source.trim().trim_end_matches('/').trim_end_matches(".git");
    let repo = value.strip_prefix("https://github.com/").unwrap_or(value);
    let parts = repo.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || p.starts_with('.')
                || !p
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return Err(
            "Enter a GitHub URL, owner/repo, or an absolute path to a local source repository"
                .into(),
        );
    }
    Ok(format!("https://github.com/{repo}.git"))
}
pub fn checkout(local: &Path, source: &str, revision: Option<&str>) -> Result<Checkout> {
    let source = normalize_source(source)?;
    let parent = local.join("downloads");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let dir = Checkout(tempfile::tempdir_in(parent).map_err(|e| e.to_string())?);
    // Use git even for local sources: only committed skill contents are adopted.
    command(
        local,
        "git",
        &[
            "clone",
            "--depth",
            "1",
            "--no-hardlinks",
            "--",
            &source,
            &dir.to_string_lossy(),
        ],
    )?;
    if let Some(revision) = revision {
        if revision.len() != 40 || !revision.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Skill version must be a full source commit identifier".into());
        }
        command(&dir, "git", &["fetch", "--depth", "1", "origin", revision])?;
        command(&dir, "git", &["checkout", "--detach", "FETCH_HEAD"])?;
    }
    Ok(dir)
}
pub fn discover(local: &Path, source: &str) -> Result<Discovery> {
    let source = normalize_source(source)?;
    let directory = checkout(local, &source, None)?;
    let revision = command(&directory, "git", &["rev-parse", "HEAD"])?;
    let mut dirs = vec![];
    fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) -> Result<()> {
        if depth > 12 {
            return Ok(());
        }
        if dir.join("SKILL.md").is_file() {
            found.push(dir.to_path_buf());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && ![".git", "node_modules", "target", ".aicfg-local"]
                    .contains(&entry.file_name().to_string_lossy().as_ref())
            {
                walk(&entry.path(), depth + 1, found)?;
            }
        }
        Ok(())
    }
    walk(&directory, 0, &mut dirs)?;
    dirs.sort();
    let mut candidates = vec![];
    for dir in dirs {
        let markdown = read(&dir.join("SKILL.md"))?;
        let (_, metadata, _) = frontmatter(&markdown)?;
        let name = metadata
            .get("name")
            .and_then(serde_yaml::Value::as_str)
            .ok_or("SKILL.md is missing its name")?
            .to_string();
        let description = metadata
            .get("description")
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or("")
            .to_string();
        let relative = dir
            .strip_prefix(&directory)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        let files = tree(&dir)?;
        candidates.push(Candidate {
            skill: Skill {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                source: source.clone(),
                skill_path: if relative.is_empty() {
                    ".".into()
                } else {
                    relative
                },
                revision: revision.clone(),
                content_hash: tree_hash(&files),
                description,
            },
            markdown,
        });
    }
    if candidates.is_empty() {
        return Err("This source repository has no valid SKILL.md".into());
    }
    Ok(Discovery {
        candidates,
        directory,
    })
}
pub fn frontmatter(markdown: &str) -> Result<(&str, serde_yaml::Value, &str)> {
    let markdown = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let rest = markdown
        .strip_prefix("---\n")
        .or_else(|| markdown.strip_prefix("---\r\n"))
        .ok_or("SKILL.md is missing YAML front matter")?;
    let (yaml, body) = rest
        .split_once("\n---")
        .ok_or("SKILL.md front matter is not closed")?;
    let metadata =
        serde_yaml::from_str(yaml).map_err(|e| format!("Invalid SKILL.md front matter: {e}"))?;
    Ok((yaml, metadata, body.trim_start_matches(['\r', '\n'])))
}
pub fn installed_markdown(bytes: &[u8], name: &str) -> Result<Vec<u8>> {
    let text = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
    let (_, mut metadata, body) = frontmatter(text)?;
    metadata
        .as_mapping_mut()
        .ok_or("Skill metadata is not an object")?
        .insert(
            serde_yaml::Value::String("name".into()),
            serde_yaml::Value::String(name.into()),
        );
    Ok(format!(
        "---\n{}---\n{}",
        serde_yaml::to_string(&metadata).map_err(|e| e.to_string())?,
        body
    )
    .into_bytes())
}
pub fn replace_snapshot(
    destination: &Path,
    files: &std::collections::BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    let parent = destination.parent().ok_or("Invalid snapshot directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
    for (path, bytes) in files {
        safe_relative(path)?;
        atomic_write(&temp.path().join(path), bytes)?;
    }
    let previous = destination.with_extension("previous");
    if previous.exists() {
        return Err("An incomplete snapshot replacement exists. Inspect local data".into());
    }
    if destination.exists() {
        fs::rename(destination, &previous).map_err(|e| e.to_string())?;
    }
    if let Err(e) = fs::rename(temp.path(), destination) {
        if previous.exists() {
            let _ = fs::rename(&previous, destination);
        }
        return Err(e.to_string());
    }
    if previous.exists() {
        fs::remove_dir_all(previous).map_err(|e| e.to_string())?;
    }
    Ok(())
}
