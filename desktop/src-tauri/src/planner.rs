use crate::{domain::*, files::*, repository::*, source::*};
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
pub enum Entry {
    Missing,
    File(Vec<u8>, u32),
    Link(String),
}
impl Entry {
    pub fn signature(&self) -> String {
        match self {
            Self::Missing => "missing".into(),
            Self::File(v, mode) => hash(&[v.as_slice(), &mode.to_le_bytes()].concat()),
            Self::Link(v) => hash(format!("link:{v}").as_bytes()),
        }
    }
    fn display(&self) -> String {
        match self {
            Self::Missing => String::new(),
            Self::File(v, _) => {
                String::from_utf8(v.clone()).unwrap_or_else(|_| "(binary file)".into())
            }
            Self::Link(v) => format!("Symbolic link: {v}"),
        }
    }
}
pub fn entry(path: &Path) -> Result<Entry> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Entry::Missing),
        Err(e) => Err(e.to_string()),
        Ok(m) if m.file_type().is_symlink() => Ok(Entry::Link(
            fs::read_link(path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
        )),
        Ok(m) if m.is_file() => {
            #[cfg(unix)]
            let mode = m.permissions().mode() & 0o777;
            #[cfg(not(unix))]
            let mode = 0o644;
            Ok(Entry::File(
                fs::read(path).map_err(|e| e.to_string())?,
                mode,
            ))
        }
        Ok(_) => Err(format!(
            "{} is an existing directory. Move it before enabling the corresponding adapter",
            path.display()
        )),
    }
}
fn write_entry(path: &Path, value: &Entry) -> Result<()> {
    match value {
        Entry::Missing => {
            if fs::symlink_metadata(path).is_ok() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        Entry::File(bytes, mode) => {
            if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            atomic_write(path, bytes)?;
            #[cfg(unix)]
            fs::set_permissions(path, fs::Permissions::from_mode(*mode))
                .map_err(|e| e.to_string())?;
        }
        Entry::Link(target) => {
            fs::create_dir_all(path.parent().ok_or("Invalid link directory")?)
                .map_err(|e| e.to_string())?;
            if fs::symlink_metadata(path).is_ok() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(target, path).map_err(|e| e.to_string())?;
            #[cfg(not(unix))]
            return Err(
                "Symbolic link adapters are only supported on macOS in the first release".into(),
            );
        }
    }
    Ok(())
}
#[derive(Serialize)]
pub struct ChangeView {
    pub path: String,
    pub kind: String,
    pub before: String,
    pub after: String,
    pub conflict: bool,
}
pub struct Change {
    pub path: String,
    pub before: Entry,
    pub after: Entry,
    pub conflict: bool,
}
#[derive(Serialize)]
pub struct Preview {
    pub token: String,
    pub changes: Vec<ChangeView>,
    pub resolution: Resolution,
}
pub struct Plan {
    pub token: String,
    pub target_id: String,
    pub config_signature: String,
    pub target_config_signature: String,
    pub changes: Vec<Change>,
    checked: BTreeMap<String, Entry>,
    pub resolution: Resolution,
    pub target_config: TargetConfig,
    pub desired_signature: String,
    pub managed: BTreeMap<String, String>,
    installed: Vec<ResolvedSkill>,
}
pub fn desired_signature(config: &Config, target: &TargetConfig) -> Result<String> {
    let resolution = resolve(config, target, &target.versions)?;
    if !resolution.conflicts.is_empty() {
        return Err("Choose the pending skill versions first".into());
    }
    let versions = resolution
        .skills
        .iter()
        .map(|s| {
            (
                &s.skill.id,
                &s.install_name,
                if s.revision == s.skill.revision {
                    s.skill.content_hash.clone()
                } else {
                    format!("commit:{}", s.revision)
                },
            )
        })
        .collect::<Vec<_>>();
    Ok(hash(
        &serde_json::to_vec(&(
            versions,
            &resolution.rules,
            &target.agents,
            &target.presets,
            &target.excluded,
        ))
        .map_err(|e| e.to_string())?,
    ))
}
pub fn config_signature(repo: &Repository) -> Result<String> {
    let mut values = BTreeMap::new();
    let path = repo.root.join("aicfg.toml");
    values.insert(
        "aicfg.toml".into(),
        if path.exists() {
            fs::read(path).map_err(|e| e.to_string())?
        } else {
            vec![]
        },
    );
    for rule in &repo.config.rules {
        values.insert(
            rule.id.clone(),
            fs::read(repo.root.join(format!("rules/{}.md", rule.id))).map_err(|e| e.to_string())?,
        );
    }
    Ok(tree_hash(&values))
}
// Bump the cache schema when the installer invocation or cached layout changes.
const INSTALLER: &str = "skills@1.7.2";
const INSTALL_CACHE_SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize)]
struct CachedInstallation {
    fingerprint: String,
    files: BTreeMap<String, Entry>,
}

fn entries_fingerprint(files: &BTreeMap<String, Entry>) -> Result<String> {
    let signatures = files
        .iter()
        .map(|(path, value)| (path, value.signature()))
        .collect::<BTreeMap<_, _>>();
    Ok(hash(
        &serde_json::to_vec(&signatures).map_err(|e| e.to_string())?,
    ))
}

fn skill_entries(
    root: &Path,
    contents: BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Entry>> {
    contents
        .into_iter()
        .map(|(path, bytes)| {
            let metadata = fs::metadata(root.join(&path)).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            let mode = metadata.permissions().mode() & 0o777;
            #[cfg(not(unix))]
            let mode = 0o644;
            Ok((path, Entry::File(bytes, mode)))
        })
        .collect()
}

fn cached_installation(
    local: &Path,
    source_files: &BTreeMap<String, Entry>,
    install: impl FnOnce() -> Result<BTreeMap<String, Entry>>,
) -> Result<BTreeMap<String, Entry>> {
    let key = hash(
        &serde_json::to_vec(&(
            INSTALL_CACHE_SCHEMA,
            INSTALLER,
            std::env::consts::OS,
            entries_fingerprint(source_files)?,
        ))
        .map_err(|e| e.to_string())?,
    );
    let relative = format!("installer-cache/{key}.json");
    guard_ancestors(local, &relative)?;
    let path = local.join(relative);
    if let Some(cached) = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CachedInstallation>(&bytes).ok())
    {
        let valid = matches!(cached.files.get("SKILL.md"), Some(Entry::File(_, _)))
            && cached.files.iter().all(|(path, value)| {
                safe_relative(path).is_ok() && matches!(value, Entry::File(_, _))
            })
            && entries_fingerprint(&cached.files)? == cached.fingerprint;
        if valid {
            return Ok(cached.files);
        }
    }
    let files = install()?;
    let cached = CachedInstallation {
        fingerprint: entries_fingerprint(&files)?,
        files,
    };
    // Cache persistence is optional; a successful installation can still be previewed.
    let _ = atomic_write(
        &path,
        &serde_json::to_vec(&cached).map_err(|e| e.to_string())?,
    );
    Ok(cached.files)
}

fn install_skill(
    local: &Path,
    source: &Path,
    source_name: &str,
) -> Result<BTreeMap<String, Entry>> {
    let stage = tempfile::tempdir_in(local).map_err(|e| e.to_string())?;
    command(
        stage.path(),
        "npx",
        &[
            "--yes",
            INSTALLER,
            "add",
            &source.to_string_lossy(),
            "--skill",
            source_name,
            "--agent",
            "codex",
            "--yes",
            "--copy",
        ],
    )?;
    let installed = fs::read_dir(stage.path().join(".agents/skills"))
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|e| e.path()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| path.join("SKILL.md").is_file())
        .collect::<Vec<_>>();
    if installed.len() != 1 {
        return Err("The installer did not create a unique skill directory".into());
    }
    skill_entries(&installed[0], tree(&installed[0])?)
}

impl Plan {
    pub fn view(&self) -> Preview {
        Preview {
            token: self.token.clone(),
            resolution: self.resolution.clone(),
            changes: self
                .changes
                .iter()
                .map(|c| ChangeView {
                    path: c.path.clone(),
                    before: c.before.display(),
                    after: c.after.display(),
                    conflict: c.conflict,
                    kind: if c.conflict {
                        "Conflict"
                    } else if c.after == Entry::Missing {
                        "Remove"
                    } else if c.before == Entry::Missing {
                        "Add"
                    } else {
                        "Update"
                    }
                    .into(),
                })
                .collect(),
        }
    }
    pub fn build(
        repo: &mut Repository,
        target_id: &str,
        choices: BTreeMap<String, String>,
    ) -> Result<Self> {
        repo.reload()?;
        let target = repo
            .local
            .targets
            .iter()
            .find(|t| t.id == target_id)
            .ok_or("Target project does not exist")?
            .clone();
        if target.repair {
            return Err(
                "This target project needs repair. Updates are paused until it is repaired".into(),
            );
        }
        let root = Path::new(&target.path);
        let original_config = repo.target_config(&target)?;
        let mut target_config = original_config.clone();
        target_config.versions = choices.clone();
        let resolution = resolve(&repo.config, &target_config, &choices)?;
        if !resolution.conflicts.is_empty() {
            return Ok(Self {
                token: String::new(),
                target_id: target_id.into(),
                config_signature: String::new(),
                target_config_signature: String::new(),
                changes: vec![],
                checked: BTreeMap::new(),
                desired_signature: String::new(),
                managed: BTreeMap::new(),
                installed: vec![],
                resolution,
                target_config,
            });
        }
        let mut desired = BTreeMap::<String, Entry>::new();
        let mut installed = vec![];
        for item in &resolution.skills {
            let snapshot = repo.snapshot(&item.skill.id);
            let snapshot_contents = if snapshot.exists() && item.revision == item.skill.revision {
                Some(tree(&snapshot)?)
            } else {
                None
            };
            let usable = snapshot_contents
                .as_ref()
                .is_some_and(|contents| tree_hash(contents) == item.skill.content_hash);
            let download;
            let source = if usable {
                snapshot
            } else {
                download = checkout_ref(
                    &repo.root.join(".aicfg-local"),
                    &item.skill.source,
                    item.skill.source_ref.as_deref(),
                    Some(&item.revision),
                )?;
                if item.skill.skill_path != "." {
                    safe_relative(&item.skill.skill_path)?;
                }
                download.join(&item.skill.skill_path)
            };
            let contents = if usable {
                snapshot_contents.unwrap()
            } else {
                tree(&source)?
            };
            let content_hash = tree_hash(&contents);
            let mut record = item.clone();
            record.skill.revision = item.revision.clone();
            record.skill.content_hash = content_hash.clone();
            installed.push(record);
            let source_markdown = read(&source.join("SKILL.md"))?;
            let (_, metadata, _) = frontmatter(&source_markdown)?;
            let source_name = metadata
                .get("name")
                .and_then(serde_yaml::Value::as_str)
                .ok_or("Source skill is missing its name")?;
            if item.revision == item.skill.revision && content_hash != item.skill.content_hash {
                return Err(format!(
                    "Source content for {} does not match the adopted fingerprint",
                    item.skill.name
                ));
            }
            let source_files = skill_entries(&source, contents)?;
            let local = repo.root.join(".aicfg-local");
            let prepared = cached_installation(&local, &source_files, || {
                install_skill(&local, &source, source_name)
            })?;
            // Naming depends on preset resolution, so rewrite it after cache lookup.
            for (relative, mut value) in prepared {
                if relative == "SKILL.md" {
                    if let Entry::File(bytes, _) = &mut value {
                        *bytes = installed_markdown(bytes, &item.install_name)?;
                    }
                }
                desired.insert(
                    format!(".agents/skills/{}/{}", item.install_name, relative),
                    value,
                );
            }
        }
        let mut references = vec![];
        for rule in &resolution.rules {
            let filename = format!("{}.md", rule.id);
            let yaml = if rule.paths.is_empty() {
                String::new()
            } else {
                format!(
                    "---\n{}---\n",
                    serde_yaml::to_string(&serde_json::json!({ "paths": rule.paths }))
                        .map_err(|e| e.to_string())?
                )
            };
            desired.insert(
                format!(".agents/rules/{filename}"),
                Entry::File(format!("{yaml}{}", rule.body).into_bytes(), 0o644),
            );
            references.push(format!(
                "- [{}](.agents/rules/{filename})",
                rule.name.replace(']', "\\]")
            ));
            if target_config.agents.iter().any(|a| a == "cursor") {
                let front = serde_yaml::to_string(&serde_json::json!({"description": rule.name, "globs": rule.paths.join(","), "alwaysApply": rule.paths.is_empty()})).map_err(|e| e.to_string())?;
                desired.insert(
                    format!(".cursor/rules/{}.mdc", rule.id),
                    Entry::File(
                        format!("---\n{front}---\n{}", rule.body).into_bytes(),
                        0o644,
                    ),
                );
            }
        }
        if target_config
            .agents
            .iter()
            .any(|a| a == "agents" || a == "claude")
        {
            let original = fs::read_to_string(root.join("AGENTS.md")).unwrap_or_default();
            desired.insert(
                "AGENTS.md".into(),
                Entry::File(
                    marked(
                        &original,
                        &format!("## Target project rules\n{}", references.join("\n")),
                    )?
                    .into_bytes(),
                    0o644,
                ),
            );
        }
        if target_config.agents.iter().any(|a| a == "claude") {
            let original = fs::read_to_string(root.join("CLAUDE.md")).unwrap_or_default();
            desired.insert(
                "CLAUDE.md".into(),
                Entry::File(marked(&original, "@AGENTS.md")?.into_bytes(), 0o644),
            );
            desired.insert(
                ".claude/skills".into(),
                Entry::Link("../.agents/skills".into()),
            );
            desired.insert(
                ".claude/rules".into(),
                Entry::Link("../.agents/rules".into()),
            );
        }
        desired.insert(
            ".aicfg.toml".into(),
            Entry::File(
                toml::to_string_pretty(&target_config)
                    .map_err(|e| e.to_string())?
                    .into_bytes(),
                0o644,
            ),
        );
        let managed = desired
            .iter()
            .map(|(k, v)| (k.clone(), v.signature()))
            .collect();
        for path in target.managed.keys() {
            if !desired.contains_key(path) {
                // Handwritten parts of instruction files survive adapter removal.
                if ["AGENTS.md", "CLAUDE.md"].contains(&path.as_str()) {
                    let text = read(&root.join(path))?;
                    let updated = marked(&text, "")?;
                    desired.insert(path.clone(), Entry::File(updated.into_bytes(), 0o644));
                } else {
                    desired.insert(path.clone(), Entry::Missing);
                }
            }
        }
        let mut changes = vec![];
        let mut checked = BTreeMap::new();
        for (path, after) in desired {
            guard_ancestors(root, &path)?;
            let before = entry(&root.join(&path))?;
            checked.insert(path.clone(), before.clone());
            let conflict = before != Entry::Missing
                && !target.managed.contains_key(&path)
                && ![".aicfg.toml", "AGENTS.md", "CLAUDE.md"].contains(&path.as_str());
            if before != after || conflict {
                changes.push(Change {
                    path,
                    before,
                    after,
                    conflict,
                });
            }
        }
        Ok(Self {
            token: uuid::Uuid::new_v4().to_string(),
            target_id: target_id.into(),
            config_signature: config_signature(repo)?,
            target_config_signature: entry(&root.join(".aicfg.toml"))?.signature(),
            desired_signature: desired_signature(&repo.config, &target_config)?,
            changes,
            checked,
            resolution,
            target_config,
            managed,
            installed,
        })
    }
    pub fn apply(
        self,
        repo: &mut Repository,
        decisions: &BTreeMap<String, String>,
    ) -> Result<String> {
        let index = repo
            .local
            .targets
            .iter()
            .position(|t| t.id == self.target_id)
            .ok_or("Target project does not exist")?;
        let original = repo.local.targets[index].clone();
        if original.repair {
            return Err("Target project needs repair. Updates are paused".into());
        }
        let root = Path::new(&original.path);
        if config_signature(repo)? != self.config_signature
            || entry(&root.join(".aicfg.toml"))?.signature() != self.target_config_signature
        {
            return Err("Configuration changed after preview. Preview again".into());
        }
        for (path, before) in &self.checked {
            guard_ancestors(root, path)?;
            if entry(&root.join(path))? != *before {
                return Err(format!("{path} changed after preview. Preview again"));
            }
        }
        for change in &self.changes {
            if change.conflict
                && ![Some("takeover"), Some("replace"), Some("skip")]
                    .contains(&decisions.get(&change.path).map(String::as_str))
            {
                return Err(format!(
                    "Choose how to resolve the conflict for {} first",
                    change.path
                ));
            }
        }
        let mut written = vec![];
        let mut managed = self.managed.clone();
        let mut skipped = false;
        let skipped_skills = self
            .changes
            .iter()
            .filter(|c| decisions.get(&c.path).is_some_and(|d| d == "skip"))
            .filter_map(|c| {
                c.path
                    .strip_prefix(".agents/skills/")
                    .and_then(|p| p.split_once('/'))
                    .map(|(name, _)| format!(".agents/skills/{name}/"))
            })
            .collect::<Vec<_>>();
        managed.retain(|path, _| !skipped_skills.iter().any(|prefix| path.starts_with(prefix)));
        let mut created_dirs = vec![];
        let result = (|| {
            if self.target_config.agents.iter().any(|a| a == "claude") {
                for path in [".agents", ".agents/skills", ".agents/rules"] {
                    guard_ancestors(root, &format!("{path}/.layout"))?;
                    let dir = root.join(path);
                    if !dir.exists() {
                        fs::create_dir(&dir).map_err(|e| e.to_string())?;
                        created_dirs.push(dir);
                    }
                }
            }
            for change in &self.changes {
                if skipped_skills
                    .iter()
                    .any(|prefix| change.path.starts_with(prefix))
                    || decisions.get(&change.path).is_some_and(|d| d == "skip")
                {
                    skipped = true;
                    managed.remove(&change.path);
                    continue;
                }
                if change.conflict && decisions.get(&change.path).is_some_and(|d| d == "takeover") {
                    managed.insert(change.path.clone(), change.before.signature());
                    skipped |= change.before != change.after;
                    continue;
                }
                // Include attempted writes: an I/O error can occur after partial mutation.
                written.push(change);
                write_entry(&root.join(&change.path), &change.after)?;
            }
            repo.local.targets[index].managed = managed;
            if !skipped {
                repo.local.targets[index].installed = self.installed.clone();
            }
            repo.local.targets[index].applied = if skipped {
                String::new()
            } else {
                self.desired_signature.clone()
            };
            repo.local_save()
        })();
        if let Err(error) = result {
            let mut failures = vec![];
            for change in written.into_iter().rev() {
                if let Err(e) = write_entry(&root.join(&change.path), &change.before) {
                    failures.push(e);
                }
            }
            for dir in created_dirs.into_iter().rev() {
                let _ = fs::remove_dir(dir);
            }
            repo.local.targets[index] = original;
            if !failures.is_empty() {
                repo.local.targets[index].repair = true;
                let marker = repo.local_save();
                return Err(format!(
                    "Update failed: {error}; recovery also failed, target project needs repair: {}; state record: {marker:?}",
                    failures.join("; ")
                ));
            }
            return Err(format!(
                "Update failed; previous contents restored: {error}"
            ));
        }
        Ok(if skipped {
            "Applied; preserved or skipped content still needs syncing"
        } else {
            "Target project is synced"
        }
        .into())
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use std::cell::Cell;

    fn files(body: &[u8], mode: u32) -> BTreeMap<String, Entry> {
        BTreeMap::from([
            ("SKILL.md".into(), Entry::File(body.to_vec(), 0o644)),
            (
                "check.sh".into(),
                Entry::File(b"#!/bin/sh\n".to_vec(), mode),
            ),
        ])
    }

    #[test]
    fn unchanged_skills_reuse_disk_cache_and_only_changed_inputs_are_installed() {
        let local = tempfile::tempdir().unwrap();
        let calls = Cell::new(0);
        let first = files(b"first", 0o755);
        let second = files(b"second", 0o644);
        let install = |input: &BTreeMap<String, Entry>| {
            cached_installation(local.path(), input, || {
                calls.set(calls.get() + 1);
                Ok(input.clone())
            })
            .unwrap()
        };
        assert_eq!(install(&first), first);
        assert_eq!(install(&second), second);
        assert_eq!(calls.get(), 2);
        assert_eq!(install(&first), first);
        assert_eq!(install(&second), second);
        assert_eq!(calls.get(), 2);
        let changed = files(b"second updated", 0o644);
        assert_eq!(install(&changed), changed);
        assert_eq!(install(&first), first);
        assert_eq!(calls.get(), 3);
        let permissions_changed = files(b"first", 0o644);
        assert_eq!(install(&permissions_changed), permissions_changed);
        assert_eq!(calls.get(), 4);
    }

    #[test]
    fn corrupt_cache_is_rebuilt_and_failed_installs_are_not_cached() {
        let local = tempfile::tempdir().unwrap();
        let source = files(b"source", 0o755);
        let prepared = files(b"installer output", 0o755);
        cached_installation(local.path(), &source, || Ok(prepared.clone())).unwrap();
        let path = fs::read_dir(local.path().join("installer-cache"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let mut cached: CachedInstallation =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        cached.files = files(b"corrupted", 0o644);
        fs::write(&path, serde_json::to_vec(&cached).unwrap()).unwrap();
        assert_eq!(
            cached_installation(local.path(), &source, || Ok(prepared.clone())).unwrap(),
            prepared
        );
        fs::write(&path, b"incomplete JSON").unwrap();
        assert!(
            cached_installation(local.path(), &source, || Err("installer failed".into())).is_err()
        );
        assert_eq!(
            cached_installation(local.path(), &source, || Ok(prepared.clone())).unwrap(),
            prepared
        );
        assert_eq!(
            cached_installation(local.path(), &source, || panic!("cache should be reused"))
                .unwrap(),
            prepared
        );
    }
}
