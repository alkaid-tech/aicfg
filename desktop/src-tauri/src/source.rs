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
#[derive(Debug)]
pub struct SkillSource {
    pub repository: String,
    pub reference: Option<String>,
    pub directory: String,
}

pub fn parse_skill_source(source: &str) -> Result<SkillSource> {
    let value = source.trim().trim_end_matches('/');
    if let Some(github) = value.strip_prefix("https://github.com/") {
        let parts = github.split('/').collect::<Vec<_>>();
        if parts.len() >= 4 && parts[2] == "tree" {
            let decode = |value: &str| {
                percent_encoding::percent_decode_str(value)
                    .decode_utf8()
                    .map(|value| value.into_owned())
                    .map_err(|_| "GitHub source URL contains invalid UTF-8".to_string())
            };
            let reference = decode(parts[3])?;
            if reference.is_empty() || reference.starts_with('-') {
                return Err("GitHub directory URL is missing a valid branch or tag".into());
            }
            let path = parts[4..]
                .iter()
                .map(|part| decode(part))
                .collect::<Result<Vec<_>>>()?;
            if path.iter().any(|part| {
                part.is_empty() || part == "." || part == ".." || part.contains(['/', '\\'])
            }) {
                return Err("GitHub source URL contains an invalid directory path".into());
            }
            let directory = path.join("/");
            if !directory.is_empty() {
                safe_relative(&directory)?;
            }
            return Ok(SkillSource {
                repository: normalize_source(&format!("{}/{}", parts[0], parts[1]))?,
                reference: Some(reference),
                directory,
            });
        }
    }
    Ok(SkillSource {
        repository: normalize_source(value)?,
        reference: None,
        directory: String::new(),
    })
}

pub fn checkout(local: &Path, source: &str, revision: Option<&str>) -> Result<Checkout> {
    checkout_ref(local, source, None, revision)
}

pub fn checkout_ref(
    local: &Path,
    source: &str,
    reference: Option<&str>,
    revision: Option<&str>,
) -> Result<Checkout> {
    let source = normalize_source(source)?;
    if revision
        .is_some_and(|value| value.len() != 40 || !value.chars().all(|c| c.is_ascii_hexdigit()))
    {
        return Err("Skill version must be a full source commit identifier".into());
    }
    if let Some(reference) = reference {
        if reference.starts_with('-') {
            return Err("Invalid source branch or tag".into());
        }
        command(
            local,
            "git",
            &["check-ref-format", "--allow-onelevel", reference],
        )?;
    }
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
    if let Some(reference) = revision.or(reference) {
        command(&dir, "git", &["fetch", "--depth", "1", "origin", reference])?;
        command(&dir, "git", &["checkout", "--detach", "FETCH_HEAD"])?;
    }
    Ok(dir)
}
pub fn discover(local: &Path, source: &str) -> Result<Discovery> {
    discover_source(local, parse_skill_source(source)?)
}

fn discover_source(local: &Path, source: SkillSource) -> Result<Discovery> {
    let directory = checkout_ref(local, &source.repository, source.reference.as_deref(), None)?;
    let revision = command(&directory, "git", &["rev-parse", "HEAD"])?;
    let mut dirs = vec![];
    fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) -> Result<()> {
        if depth > 12 {
            return Ok(());
        }
        if dir.join("SKILL.md").is_file() {
            found.push(dir.to_path_buf());
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !entry.file_name().to_string_lossy().starts_with('.')
                && entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && !["node_modules", "target"]
                    .contains(&entry.file_name().to_string_lossy().as_ref())
            {
                walk(&path, depth + 1, found)?;
            }
        }
        Ok(())
    }
    let root = directory.join(&source.directory);
    if !source.directory.is_empty() {
        guard_ancestors(&directory, &format!("{}/SKILL.md", source.directory))?;
    }
    if !root.is_dir() {
        return Err(format!(
            "Source directory does not exist: {}",
            source.directory
        ));
    }
    walk(&root, 0, &mut dirs)?;
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
                source: source.repository.clone(),
                source_ref: source.reference.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Engine, Request};

    fn write_skill(root: &Path, path: &str, name: &str, body: &str) {
        let path = root.join(path);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Test skill\n---\n{body}\n"),
        )
        .unwrap();
    }

    fn init(root: &Path) {
        fs::create_dir_all(root).unwrap();
        command(root, "git", &["init", "-b", "main"]).unwrap();
        command(root, "git", &["config", "user.name", "Source test"]).unwrap();
        command(
            root,
            "git",
            &["config", "user.email", "source@example.invalid"],
        )
        .unwrap();
    }

    fn commit(root: &Path) {
        command(root, "git", &["add", "."]).unwrap();
        command(root, "git", &["commit", "-m", "test: update fixture"]).unwrap();
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("source");
        let local = temp.path().join("local");
        init(&repo);
        fs::create_dir(&local).unwrap();
        write_skill(&repo, "docs/skills/review", "review", "Main branch");
        write_skill(
            &repo,
            "docs/skills/review/references/refs/helper",
            "helper",
            "Reference copy",
        );
        write_skill(
            &repo,
            "docs/skills/review/.references/helper",
            "hidden-helper",
            "Hidden reference content",
        );
        write_skill(
            &repo,
            "packages/demo/.cache/installed",
            "cached",
            "Nested hidden skill",
        );
        write_skill(&repo, "other", "other", "Outside selected directory");
        for agent in [
            ".agents",
            ".claude",
            ".cursor",
            ".codex",
            ".gemini",
            ".opencode",
            ".github",
            ".private-library",
        ] {
            write_skill(
                &repo,
                &format!("{agent}/skills/installed"),
                "installed",
                "Installed skill",
            );
        }
        commit(&repo);
        (temp, repo, local)
    }

    #[test]
    fn github_tree_urls_preserve_refs_and_decode_directory_names() {
        let parsed =
            parse_skill_source(" https://github.com/example/skills/tree/main/docs/skills/ ")
                .unwrap();
        assert_eq!(parsed.repository, "https://github.com/example/skills.git");
        assert_eq!(parsed.reference.as_deref(), Some("main"));
        assert_eq!(parsed.directory, "docs/skills");
        let parsed = parse_skill_source(
            "https://github.com/example/skills/tree/feature%2Fskills/docs/my%20skills",
        )
        .unwrap();
        assert_eq!(parsed.reference.as_deref(), Some("feature/skills"));
        assert_eq!(parsed.directory, "docs/my skills");
        for source in ["example/skills", "https://github.com/example/skills.git/"] {
            let parsed = parse_skill_source(source).unwrap();
            assert_eq!(parsed.repository, "https://github.com/example/skills.git");
            assert!(parsed.reference.is_none());
            assert!(parsed.directory.is_empty());
        }
    }

    #[test]
    fn github_tree_urls_reject_unsafe_directories_and_missing_refs() {
        for suffix in [
            "tree/",
            "tree//docs",
            "tree/-branch/docs",
            "tree/main/docs/..",
            "tree/main/docs/%2E%2E",
            "tree/main/docs/%2Ftmp",
            "tree/main/docs/%5Ctmp",
            "tree/main/docs//skills",
        ] {
            assert!(
                parse_skill_source(&format!("https://github.com/example/skills/{suffix}")).is_err(),
                "{suffix}"
            );
        }
    }

    #[test]
    fn directory_discovery_keeps_nested_reference_skills_as_content() {
        let (_temp, repo, local) = fixture();
        let found = discover_source(
            &local,
            SkillSource {
                repository: repo.to_string_lossy().into(),
                reference: Some("main".into()),
                directory: "docs/skills".into(),
            },
        )
        .unwrap();
        assert_eq!(found.candidates.len(), 1);
        let skill = &found.candidates[0].skill;
        assert_eq!(skill.skill_path, "docs/skills/review");
        assert_eq!(skill.source_ref.as_deref(), Some("main"));
        assert!(
            tree(&found.directory.join(&skill.skill_path))
                .unwrap()
                .contains_key("references/refs/helper/SKILL.md")
        );
        assert!(
            tree(&found.directory.join(&skill.skill_path))
                .unwrap()
                .contains_key(".references/helper/SKILL.md")
        );
        assert!(
            discover_source(
                &local,
                SkillSource {
                    repository: repo.to_string_lossy().into(),
                    reference: None,
                    directory: "missing".into(),
                }
            )
            .is_err()
        );
    }

    #[test]
    fn discovery_skips_hidden_directories_but_allows_explicit_hidden_sources() {
        let (_temp, repo, local) = fixture();
        let found = discover(&local, &repo.to_string_lossy()).unwrap();
        assert_eq!(
            found
                .candidates
                .iter()
                .map(|c| c.skill.name.as_str())
                .collect::<Vec<_>>(),
            ["review", "other"]
        );
        for agent in [
            ".agents",
            ".claude",
            ".cursor",
            ".codex",
            ".gemini",
            ".opencode",
            ".github",
            ".private-library",
        ] {
            let found = discover_source(
                &local,
                SkillSource {
                    repository: repo.to_string_lossy().into(),
                    reference: None,
                    directory: format!("{agent}/skills"),
                },
            )
            .unwrap();
            assert_eq!(found.candidates.len(), 1);
            assert_eq!(found.candidates[0].skill.name, "installed");
        }
    }

    #[test]
    fn branch_sources_survive_persistence_and_update_independently() {
        let (temp, repo, local) = fixture();
        let main = discover(&local, &repo.to_string_lossy())
            .unwrap()
            .candidates
            .into_iter()
            .find(|c| c.skill.name == "review")
            .unwrap()
            .skill;
        command(&repo, "git", &["switch", "-c", "feature/skills"]).unwrap();
        write_skill(&repo, "docs/skills/review", "review", "Feature branch");
        commit(&repo);
        command(&repo, "git", &["switch", "main"]).unwrap();
        let feature = discover_source(
            &local,
            SkillSource {
                repository: repo.to_string_lossy().into(),
                reference: Some("feature/skills".into()),
                directory: "docs/skills/review".into(),
            },
        )
        .unwrap()
        .candidates
        .remove(0)
        .skill;
        let config_root = temp.path().join("configuration");
        init(&config_root);
        let mut engine = Engine::new(None);
        engine
            .execute(Request::Open {
                path: config_root.to_string_lossy().into(),
            })
            .unwrap();
        engine
            .execute(Request::Save {
                config: Config {
                    library: vec![main, feature.clone()],
                    ..Default::default()
                },
            })
            .unwrap();
        engine
            .execute(Request::Open {
                path: config_root.to_string_lossy().into(),
            })
            .unwrap();
        assert!(
            engine
                .execute(Request::CheckUpdates)
                .unwrap()
                .updates
                .unwrap()
                .is_empty()
        );
        assert!(
            engine
                .execute(Request::ReadSkill {
                    id: feature.id.clone()
                })
                .unwrap()
                .markdown
                .unwrap()
                .contains("Feature branch")
        );
        command(&repo, "git", &["switch", "feature/skills"]).unwrap();
        write_skill(&repo, "docs/skills/review", "review", "Feature update");
        commit(&repo);
        command(&repo, "git", &["switch", "main"]).unwrap();
        let updates = engine
            .execute(Request::CheckUpdates)
            .unwrap()
            .updates
            .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].id, feature.id);
        assert_eq!(updates[0].source_ref.as_deref(), Some("feature/skills"));
        engine
            .execute(Request::AdoptUpdates {
                ids: vec![feature.id.clone()],
            })
            .unwrap();
        assert!(
            engine
                .execute(Request::ReadSkill { id: feature.id })
                .unwrap()
                .markdown
                .unwrap()
                .contains("Feature update")
        );
    }
}
