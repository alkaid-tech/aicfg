use crate::{domain::*, files::*};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Local {
    #[serde(default)]
    pub targets: Vec<Target>,
    #[serde(default)]
    pub push_paused: bool,
    #[serde(default)]
    pub pending_paths: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Target {
    pub id: String,
    pub name: String,
    pub path: String,
    pub identity: String,
    #[serde(default)]
    pub repair: bool,
    #[serde(default)]
    pub managed: BTreeMap<String, String>,
    #[serde(default)]
    pub applied: String,
    #[serde(default)]
    pub installed: Vec<ResolvedSkill>,
}
#[derive(Serialize, Deserialize)]
struct RuleMeta {
    id: String,
    name: String,
    #[serde(default)]
    paths: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct Stored {
    schema_version: u32,
    #[serde(default)]
    library: Vec<Skill>,
    #[serde(default)]
    presets: Vec<Preset>,
    #[serde(default)]
    rules: Vec<RuleMeta>,
}

pub struct Repository {
    pub root: PathBuf,
    pub config: Config,
    pub local: Local,
}
impl Repository {
    pub fn open(path: &Path) -> Result<Self> {
        let root = path
            .canonicalize()
            .map_err(|e| format!("Configuration directory is unavailable: {e}"))?;
        let toplevel = command(&root, "git", &["rev-parse", "--show-toplevel"])?;
        if Path::new(&toplevel)
            .canonicalize()
            .map_err(|e| e.to_string())?
            != root
        {
            return Err("Choose the configuration repository root".into());
        }
        guard_ancestors(&root, ".aicfg-local/state.toml")?;
        fs::create_dir_all(root.join(".aicfg-local")).map_err(|e| e.to_string())?;
        // Local-only data is excluded without staging unrelated user .gitignore changes.
        let git_dir = command(&root, "git", &["rev-parse", "--absolute-git-dir"])?;
        let exclude = Path::new(&git_dir).join("info/exclude");
        let existing = fs::read_to_string(&exclude).unwrap_or_default();
        if !existing.lines().any(|l| l == "/.aicfg-local/") {
            atomic_write(&exclude, format!("{existing}\n/.aicfg-local/\n").as_bytes())?;
        }
        let config = Self::load_config(&root)?;
        let local_path = root.join(".aicfg-local/state.toml");
        let local = if local_path.exists() {
            toml::from_str(&read(&local_path)?)
                .map_err(|e| format!("Local state is corrupt: {e}"))?
        } else {
            Local::default()
        };
        Ok(Self {
            root,
            config,
            local,
        })
    }
    fn load_config(root: &Path) -> Result<Config> {
        let path = root.join("aicfg.toml");
        if !path.exists() {
            return Ok(Config {
                schema_version: 1,
                ..Default::default()
            });
        }
        let stored: Stored = toml::from_str(&read(&path)?)
            .map_err(|e| format!("Invalid configuration TOML: {e}"))?;
        let mut rules = vec![];
        for rule in stored.rules {
            uuid::Uuid::parse_str(&rule.id).map_err(|_| "Invalid rule identifier")?;
            let body = read(&root.join(format!("rules/{}.md", rule.id)))?;
            rules.push(Rule {
                id: rule.id,
                name: rule.name,
                paths: rule.paths,
                body,
            });
        }
        let config = Config {
            schema_version: stored.schema_version,
            library: stored.library,
            presets: stored.presets,
            rules,
        };
        validate(&config)?;
        Ok(config)
    }
    pub fn reload(&mut self) -> Result<()> {
        self.config = Self::load_config(&self.root)?;
        Ok(())
    }
    pub fn local_save(&self) -> Result<()> {
        atomic_write(
            &self.root.join(".aicfg-local/state.toml"),
            toml::to_string_pretty(&self.local)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
    }
    pub fn save(&mut self, next: Config) -> Result<String> {
        validate(&next)?;
        let stored = Stored {
            schema_version: 1,
            library: next.library.clone(),
            presets: next.presets.clone(),
            rules: next
                .rules
                .iter()
                .map(|r| RuleMeta {
                    id: r.id.clone(),
                    name: r.name.clone(),
                    paths: r.paths.clone(),
                })
                .collect(),
        };
        let bytes = toml::to_string_pretty(&stored).map_err(|e| e.to_string())?;
        let mut writes = BTreeMap::from([("aicfg.toml".to_string(), Some(bytes.into_bytes()))]);
        for rule in &next.rules {
            let path = format!("rules/{}.md", rule.id);
            writes.insert(path, Some(rule.body.as_bytes().to_vec()));
        }
        for old in &self.config.rules {
            if !next.rules.iter().any(|r| r.id == old.id) {
                let path = format!("rules/{}.md", old.id);
                writes.insert(path, None);
            }
        }
        let mut before = BTreeMap::new();
        for path in writes.keys() {
            guard_ancestors(&self.root, path)?;
            let full = self.root.join(path);
            if fs::symlink_metadata(&full).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(format!(
                    "Configuration file must not be a symbolic link: {path}"
                ));
            }
            before.insert(
                path.clone(),
                match fs::read(full) {
                    Ok(bytes) => Some(bytes),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(e) => return Err(e.to_string()),
                },
            );
        }
        let write = |path: &str, value: &Option<Vec<u8>>| -> Result<()> {
            let full = self.root.join(path);
            if let Some(bytes) = value {
                atomic_write(&full, bytes)
            } else if full.exists() {
                fs::remove_file(full).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        };
        let mut attempted = vec![];
        for (path, value) in &writes {
            attempted.push(path);
            if let Err(error) = write(path, value) {
                let mut failures = vec![];
                for path in attempted.into_iter().rev() {
                    if let Err(e) = write(path, &before[path]) {
                        failures.push(e);
                    }
                }
                return Err(if failures.is_empty() {
                    format!("Could not save configuration; original contents restored: {error}")
                } else {
                    format!(
                        "Could not save configuration: {error}; recovery failed, inspect the configuration repository: {}",
                        failures.join("; ")
                    )
                });
            }
        }
        let paths = writes.into_keys().collect::<Vec<_>>();
        self.config = next;
        for path in paths {
            if !self.local.pending_paths.contains(&path) {
                self.local.pending_paths.push(path);
            }
        }
        self.local_save()?;
        match self.commit_paths(&self.local.pending_paths.clone()) {
            Ok(()) => {
                self.local.pending_paths.clear();
                self.local_save()?;
                self.push_after_commit()
            }
            Err(e) => Ok(format!("Saved, not committed: {e}")),
        }
    }
    fn commit_paths(&self, paths: &[String]) -> Result<()> {
        let staged = command(&self.root, "git", &["diff", "--cached", "--name-only"])?;
        if staged.lines().any(|path| !paths.iter().any(|p| p == path)) {
            return Err("The configuration repository has other staged changes. Resolve them with Git first".into());
        }
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        command(&self.root, "git", &args)?;
        let mut args = vec!["diff", "--cached", "--name-only", "--"];
        args.extend(paths.iter().map(String::as_str));
        if command(&self.root, "git", &args)?.is_empty() {
            return Ok(());
        }
        command(
            &self.root,
            "git",
            &[
                "commit",
                "-m",
                "feat(config): save skills and preset configuration",
            ],
        )?;
        Ok(())
    }
    pub fn push_after_commit(&mut self) -> Result<String> {
        if self.local.push_paused {
            return Ok("Committed locally; automatic pushing is paused. Push manually".into());
        }
        if command(&self.root, "git", &["remote"])?.is_empty() {
            return Ok("Committed locally; the configuration repository has no remote".into());
        }
        match command(&self.root, "git", &["push"]) {
            Ok(_) => Ok("Synced with remote".into()),
            Err(e) => {
                self.local.push_paused = true;
                self.local_save()?;
                Ok(format!("Committed locally; push failed: {e}"))
            }
        }
    }
    pub fn git(&mut self, operation: &str) -> Result<String> {
        match operation {
            "reload" => {
                self.reload()?;
                Ok("Configuration reloaded".into())
            }
            "commit" => {
                let mut paths = self.local.pending_paths.clone();
                if !paths.iter().any(|p| p == "aicfg.toml") {
                    paths.push("aicfg.toml".into());
                }
                paths.extend(
                    self.config
                        .rules
                        .iter()
                        .map(|r| format!("rules/{}.md", r.id)),
                );
                self.commit_paths(&paths)?;
                self.local.pending_paths.clear();
                self.local_save()?;
                self.push_after_commit()
            }
            "push" => {
                command(&self.root, "git", &["push"])?;
                self.local.push_paused = false;
                self.local_save()?;
                Ok("Synced with remote".into())
            }
            "sync" => {
                if !command(&self.root, "git", &["status", "--porcelain"])?.is_empty() {
                    return Err("Commit local configuration changes before syncing".into());
                }
                command(&self.root, "git", &["fetch"])?;
                command(&self.root, "git", &["merge", "--no-edit", "@{upstream}"]).map_err(
                    |e| {
                        format!(
                            "Merge incomplete. Resolve it with your Git tools, then reload: {e}"
                        )
                    },
                )?;
                self.reload()?;
                self.local.push_paused = false;
                self.local_save()?;
                self.push_after_commit()
            }
            "pull" => {
                if !command(&self.root, "git", &["status", "--porcelain"])?.is_empty() {
                    return Ok(
                        "Local changes are not committed. Keeping current configuration".into(),
                    );
                }
                command(&self.root, "git", &["fetch"])?;
                let ahead = command(
                    &self.root,
                    "git",
                    &["rev-list", "--count", "@{upstream}..HEAD"],
                )?;
                if ahead != "0" {
                    return Ok("Local commits have not been pushed. Sync manually".into());
                }
                command(&self.root, "git", &["merge", "--ff-only", "@{upstream}"])?;
                self.reload()?;
                Ok(
                    "Configuration pulled; target projects await confirmation to apply changes"
                        .into(),
                )
            }
            _ => Err("Unknown Git operation".into()),
        }
    }
    pub fn target_config(&self, target: &Target) -> Result<TargetConfig> {
        let path = Path::new(&target.path).join(".aicfg.toml");
        if !path.exists() {
            return Ok(TargetConfig {
                agents: default_agents(),
                ..Default::default()
            });
        }
        toml::from_str(&read(&path)?)
            .map_err(|e| format!("Invalid target project configuration: {e}"))
    }
    pub fn snapshot(&self, id: &str) -> PathBuf {
        self.root.join(".aicfg-local/snapshots").join(id)
    }
}
