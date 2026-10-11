use crate::{domain::*, files::*, planner::*, repository::*, source::*};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(tag = "action", content = "data", rename_all = "snake_case")]
pub enum Request {
    State,
    Open {
        path: String,
    },
    Prepare {
        path: String,
        url: String,
    },
    Save {
        config: Config,
    },
    Inspect {
        source: String,
    },
    Favorite {
        ids: Vec<String>,
    },
    ReadSkill {
        id: String,
    },
    RelocateSource {
        id: String,
        source: String,
        skill_path: String,
    },
    AddTarget {
        path: String,
    },
    SaveTarget {
        id: String,
        config: TargetConfig,
    },
    RemoveTarget {
        id: String,
    },
    Repair {
        id: String,
    },
    Delete {
        kind: String,
        id: String,
    },
    Preview {
        id: String,
        #[serde(default)]
        choices: BTreeMap<String, String>,
    },
    Apply {
        token: String,
        #[serde(default)]
        decisions: BTreeMap<String, String>,
    },
    Git {
        operation: String,
    },
    CheckUpdates,
    AdoptUpdates {
        ids: Vec<String>,
    },
}
#[derive(Serialize)]
pub struct TargetView {
    pub target: Target,
    pub config: TargetConfig,
    pub status: String,
    pub error: Option<String>,
}
#[derive(Serialize)]
pub struct StateView {
    pub root: Option<String>,
    pub config: Config,
    pub targets: Vec<TargetView>,
    pub git_status: String,
}
#[derive(Serialize)]
pub struct Response {
    pub state: StateView,
    pub notice: Option<String>,
    pub candidates: Option<Vec<Candidate>>,
    pub preview: Option<Preview>,
    pub markdown: Option<String>,
    pub updates: Option<Vec<Skill>>,
}
pub struct Engine {
    pub repo: Option<Repository>,
    pub discovery: Option<Discovery>,
    pub plan: Option<Plan>,
    pub updates: BTreeMap<String, (Skill, PathBuf)>,
    update_sources: Vec<Checkout>,
    startup_read: bool,
    pub preference: Option<PathBuf>,
}
impl Engine {
    pub fn new(preference: Option<PathBuf>) -> Self {
        let repo = preference
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|p| Repository::open(Path::new(p.trim())).ok());
        let startup_read = repo.is_some();
        Self {
            repo,
            discovery: None,
            plan: None,
            updates: BTreeMap::new(),
            update_sources: vec![],
            startup_read,
            preference,
        }
    }
    fn repo(&mut self) -> Result<&mut Repository> {
        self.repo
            .as_mut()
            .ok_or("Choose a configuration repository first".into())
    }
    fn view(&self) -> StateView {
        let Some(repo) = &self.repo else {
            return StateView {
                root: None,
                config: Config {
                    schema_version: 1,
                    ..Default::default()
                },
                targets: vec![],
                git_status: "Not connected".into(),
            };
        };
        let targets = repo
            .local
            .targets
            .iter()
            .map(|target| {
                let config_result = repo.target_config(target);
                let mut error = config_result.as_ref().err().cloned();
                let config = config_result.unwrap_or_else(|_| TargetConfig {
                    agents: default_agents(),
                    ..Default::default()
                });
                let status = if target.repair {
                    "Needs repair"
                } else if error.is_some() || !Path::new(&target.path).exists() {
                    "Unavailable"
                } else {
                    match desired_signature(&repo.config, &config) {
                        Err(e) => {
                            error = Some(e);
                            "Pending"
                        }
                        Ok(expected) => {
                            let drift = target.managed.iter().any(|(path, expected)| {
                                if path == ".aicfg.toml" {
                                    return false;
                                }
                                entry(&Path::new(&target.path).join(path))
                                    .map_or(true, |e| e.signature() != *expected)
                            });
                            if drift {
                                "Local changes"
                            } else if expected == target.applied {
                                "Synced"
                            } else {
                                "Needs syncing"
                            }
                        }
                    }
                };
                TargetView {
                    target: target.clone(),
                    config,
                    status: status.into(),
                    error,
                }
            })
            .collect();
        let dirty = command(&repo.root, "git", &["status", "--porcelain"]).unwrap_or_default();
        let git_status = if !dirty.is_empty() {
            "Saved, not committed"
        } else if repo.local.push_paused {
            "Committed locally, pushing paused"
        } else {
            match command(
                &repo.root,
                "git",
                &["rev-list", "--count", "@{upstream}..HEAD"],
            ) {
                Ok(ahead) if ahead == "0" => "Synced with remote",
                _ => "Committed locally",
            }
        };
        StateView {
            root: Some(repo.root.to_string_lossy().into()),
            config: repo.config.clone(),
            targets,
            git_status: git_status.into(),
        }
    }
    pub fn execute(&mut self, request: Request) -> Result<Response> {
        let mut notice = None;
        let mut candidates = None;
        let mut preview = None;
        let mut markdown = None;
        let mut updates = None;
        match request {
            Request::State => {
                if self.startup_read {
                    self.startup_read = false;
                    let repo = self.repo()?;
                    if !command(&repo.root, "git", &["remote"])?.is_empty() {
                        notice = Some(repo.git("pull").unwrap_or_else(|e| {
                            format!("Keeping current configuration; could not read remote: {e}")
                        }));
                    }
                }
            }
            Request::Prepare { path, url } => {
                self.startup_read = false;
                let destination = Path::new(&path);
                if destination.exists()
                    && fs::read_dir(destination)
                        .map_err(|e| e.to_string())?
                        .next()
                        .is_some()
                {
                    return Err(
                        "Choose an empty directory. Use Connect for an existing repository".into(),
                    );
                }
                fs::create_dir_all(destination).map_err(|e| e.to_string())?;
                if url.trim().is_empty() {
                    command(destination, "git", &["init", "-b", "main"])?;
                } else {
                    let source = normalize_source(&url)?;
                    command(
                        destination.parent().ok_or("Invalid directory")?,
                        "git",
                        &["clone", "--", &source, &destination.to_string_lossy()],
                    )?;
                }
                let repo = Repository::open(destination)?;
                if let Some(preference) = &self.preference {
                    atomic_write(preference, repo.root.to_string_lossy().as_bytes())?;
                }
                self.repo = Some(repo);
                self.plan = None;
                self.discovery = None;
                self.updates.clear();
                self.update_sources.clear();
                notice = Some("Configuration repository is ready".into());
            }
            Request::Open { path } => {
                self.startup_read = false;
                let mut repo = Repository::open(Path::new(&path))?;
                notice = Some(if command(&repo.root, "git", &["remote"])?.is_empty() {
                    "Connected to the local configuration repository".into()
                } else {
                    repo.git("pull")
                        .unwrap_or_else(|e| format!("Connected; could not read remote: {e}"))
                });
                if let Some(preference) = &self.preference {
                    atomic_write(preference, repo.root.to_string_lossy().as_bytes())?;
                }
                self.repo = Some(repo);
                self.plan = None;
                self.discovery = None;
                self.updates.clear();
                self.update_sources.clear();
            }
            Request::Save { config } => {
                // Preserve references through edits; deletion must use its checked action.
                let repo = self.repo()?;
                for id in repo.config.presets.iter().map(|p| &p.id) {
                    if !config.presets.iter().any(|p| p.id == *id) {
                        return Err("Use the delete action to remove a preset".into());
                    }
                }
                if repo
                    .config
                    .library
                    .iter()
                    .any(|s| !config.library.iter().any(|n| n.id == s.id))
                    || repo
                        .config
                        .rules
                        .iter()
                        .any(|r| !config.rules.iter().any(|n| n.id == r.id))
                {
                    return Err("Use the delete action to remove a skill or rule".into());
                }
                notice = Some(repo.save(config)?);
                self.plan = None;
            }
            Request::Inspect { source } => {
                let repo = self.repo()?;
                let discovery = discover(&repo.root.join(".aicfg-local"), &source)?;
                candidates = Some(discovery.candidates.clone());
                self.discovery = Some(discovery);
                notice = Some("Source loaded. Select skills to add to your Library".into());
            }
            Request::Favorite { ids } => {
                let discovery = self
                    .discovery
                    .as_ref()
                    .ok_or("Discover the skill source first")?;
                let selected = discovery
                    .candidates
                    .iter()
                    .filter(|c| ids.contains(&c.skill.id))
                    .cloned()
                    .collect::<Vec<_>>();
                if selected.len() != ids.len() || selected.is_empty() {
                    return Err("Invalid skill selection".into());
                }
                let root = discovery.directory.to_path_buf();
                let repo = self.repo()?;
                let mut config = repo.config.clone();
                for candidate in selected {
                    if config.library.iter().any(|s| {
                        s.source == candidate.skill.source
                            && s.skill_path == candidate.skill.skill_path
                    }) {
                        continue;
                    }
                    if candidate.skill.name.contains(['/', '\\'])
                        || candidate.skill.name == "."
                        || candidate.skill.name == ".."
                    {
                        return Err("Invalid source skill name".into());
                    }
                    let source = root.join(&candidate.skill.skill_path);
                    replace_snapshot(&repo.snapshot(&candidate.skill.id), &tree(&source)?)?;
                    copy_modes(&source, &repo.snapshot(&candidate.skill.id))?;
                    config.library.push(candidate.skill);
                }
                notice = Some(repo.save(config)?);
                self.plan = None;
                self.discovery = None;
            }
            Request::ReadSkill { id } => {
                let repo = self.repo()?;
                let skill = repo
                    .config
                    .library
                    .iter()
                    .find(|s| s.id == id)
                    .ok_or("Skill does not exist")?;
                let path = repo.snapshot(&id).join("SKILL.md");
                markdown = Some(
                    if path.exists() && tree_hash(&tree(&repo.snapshot(&id))?) == skill.content_hash
                    {
                        read(&path)?
                    } else {
                        let source = checkout(
                            &repo.root.join(".aicfg-local"),
                            &skill.source,
                            Some(&skill.revision),
                        )?;
                        let dir = source.join(&skill.skill_path);
                        let files = tree(&dir)?;
                        if tree_hash(&files) != skill.content_hash {
                            return Err("Source content fingerprint does not match".into());
                        }
                        replace_snapshot(&repo.snapshot(&id), &files)?;
                        copy_modes(&dir, &repo.snapshot(&id))?;
                        read(&repo.snapshot(&id).join("SKILL.md"))?
                    },
                );
            }
            Request::RelocateSource {
                id,
                source,
                skill_path,
            } => {
                if skill_path != "." {
                    safe_relative(&skill_path)?;
                }
                let repo = self.repo()?;
                let source = normalize_source(&source)?;
                if repo
                    .config
                    .library
                    .iter()
                    .any(|s| s.id != id && s.source == source && s.skill_path == skill_path)
                {
                    return Err("Another Library entry already uses this source".into());
                }
                let mut config = repo.config.clone();
                let skill = config
                    .library
                    .iter_mut()
                    .find(|s| s.id == id)
                    .ok_or("Skill does not exist")?;
                let download = checkout(&repo.root.join(".aicfg-local"), &source, None)?;
                let directory = download.join(&skill_path);
                let text = read(&directory.join("SKILL.md"))?;
                let (_, metadata, _) = frontmatter(&text)?;
                skill.name = metadata
                    .get("name")
                    .and_then(serde_yaml::Value::as_str)
                    .ok_or("Source skill is missing its name")?
                    .into();
                skill.description = metadata
                    .get("description")
                    .and_then(serde_yaml::Value::as_str)
                    .unwrap_or("")
                    .into();
                skill.source = source;
                skill.skill_path = skill_path;
                skill.revision = command(&download, "git", &["rev-parse", "HEAD"])?;
                let files = tree(&directory)?;
                skill.content_hash = tree_hash(&files);
                validate(&config)?;
                replace_snapshot(&repo.snapshot(&id), &files)?;
                copy_modes(&directory, &repo.snapshot(&id))?;
                notice = Some(repo.save(config)?);
                self.plan = None;
                self.updates.clear();
                self.update_sources.clear();
            }
            Request::AddTarget { path } => {
                let repo = self.repo()?;
                let root = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
                let toplevel = command(&root, "git", &["rev-parse", "--show-toplevel"])?;
                if root
                    != Path::new(&toplevel)
                        .canonicalize()
                        .map_err(|e| e.to_string())?
                {
                    return Err("Choose the target project repository root".into());
                }
                if root == repo.root {
                    return Err("Use separate directories for the configuration repository and target project".into());
                }
                let identity = command(&root, "git", &["remote", "get-url", "origin"])
                    .unwrap_or_else(|_| root.to_string_lossy().into());
                if repo
                    .local
                    .targets
                    .iter()
                    .any(|t| t.identity == identity || t.path == root.to_string_lossy())
                {
                    return Err("This repository is already connected. The first release supports one local directory per target project".into());
                }
                repo.local.targets.push(Target {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    path: root.to_string_lossy().into(),
                    identity,
                    ..Default::default()
                });
                repo.local_save()?;
                notice = Some("Target project added. Choose a preset".into());
            }
            Request::SaveTarget { id, config } => {
                let repo = self.repo()?;
                if config
                    .agents
                    .iter()
                    .any(|a| !["agents", "cursor", "claude"].contains(&a.as_str()))
                {
                    return Err("Unknown agent adapter".into());
                }
                let target = repo
                    .local
                    .targets
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or("Target project does not exist")?;
                resolve(&repo.config, &config, &config.versions)?;
                let root = Path::new(&target.path);
                guard_ancestors(root, ".aicfg.toml")?;
                if fs::symlink_metadata(root.join(".aicfg.toml"))
                    .is_ok_and(|m| m.file_type().is_symlink())
                {
                    return Err("Target project configuration must not be a symbolic link".into());
                }
                atomic_write(
                    &root.join(".aicfg.toml"),
                    toml::to_string_pretty(&config)
                        .map_err(|e| e.to_string())?
                        .as_bytes(),
                )?;
                self.plan = None;
                notice = Some("Target project configuration saved. Skills and rules have not been applied yet".into());
            }
            Request::RemoveTarget { id } => {
                let repo = self.repo()?;
                repo.local.targets.retain(|t| t.id != id);
                repo.local_save()?;
                self.plan = None;
                notice = Some("Target project disconnected. Its files have been preserved".into());
            }
            Request::Repair { id } => {
                let repo = self.repo()?;
                let index = repo
                    .local
                    .targets
                    .iter()
                    .position(|t| t.id == id)
                    .ok_or("Target project does not exist")?;
                let config = repo.target_config(&repo.local.targets[index])?;
                resolve(&repo.config, &config, &config.versions)?;
                if !Path::new(&repo.local.targets[index].path).is_dir() {
                    return Err("Target project directory is unavailable".into());
                }
                repo.local.targets[index].repair = false;
                repo.local.targets[index].applied.clear();
                repo.local_save()?;
                notice = Some("Repair pause cleared. Preview again before applying changes".into());
            }
            Request::Delete { kind, id } => {
                let repo = self.repo()?;
                let referenced = repo.config.presets.iter().any(|p| match kind.as_str() {
                    "skill" => p.skills.iter().any(|s| s.skill_id == id),
                    "rule" => p.rules.contains(&id),
                    "preset" => p.includes.contains(&id),
                    _ => false,
                });
                if referenced {
                    return Err(
                        "A preset still references this item. Remove its references first".into(),
                    );
                }
                for target in &repo.local.targets {
                    let target_config = repo.target_config(target)?;
                    if kind == "preset" && target_config.presets.contains(&id) {
                        return Err(format!(
                            "{} still uses this preset. Remove its references first",
                            target.name
                        ));
                    }
                }
                let mut config = repo.config.clone();
                match kind.as_str() {
                    "skill" => config.library.retain(|s| s.id != id),
                    "preset" => config.presets.retain(|p| p.id != id),
                    "rule" => config.rules.retain(|r| r.id != id),
                    _ => return Err("Unknown object type".into()),
                }
                notice = Some(repo.save(config)?);
                self.plan = None;
            }
            Request::Preview { id, choices } => {
                let plan = Plan::build(self.repo()?, &id, choices)?;
                preview = Some(plan.view());
                self.plan = Some(plan);
            }
            Request::Apply { token, decisions } => {
                let plan = self.plan.take().ok_or("Preview expired. Preview again")?;
                if plan.token != token || token.is_empty() {
                    return Err("Preview expired. Preview again".into());
                }
                notice = Some(plan.apply(self.repo()?, &decisions)?);
            }
            Request::Git { operation } => {
                notice = Some(self.repo()?.git(&operation)?);
                self.plan = None;
            }
            Request::CheckUpdates => {
                let repo = self.repo()?;
                let library = repo.config.library.clone();
                let local = repo.root.join(".aicfg-local");
                let mut found = BTreeMap::new();
                let mut repositories = BTreeMap::<String, Checkout>::new();
                for skill in library {
                    let directory = if let Some(dir) = repositories.get(&skill.source) {
                        dir.to_path_buf()
                    } else {
                        let dir = checkout(&local, &skill.source, None)?;
                        let path = dir.to_path_buf();
                        repositories.insert(skill.source.clone(), dir);
                        path
                    };
                    let revision = command(&directory, "git", &["rev-parse", "HEAD"])?;
                    let folder = directory.join(&skill.skill_path);
                    let content_hash = tree_hash(&tree(&folder)?);
                    if content_hash != skill.content_hash {
                        let mut next = skill;
                        next.revision = revision;
                        next.content_hash = content_hash;
                        found.insert(next.id.clone(), (next, folder));
                    }
                }
                updates = Some(found.values().map(|(s, _)| s.clone()).collect());
                notice = Some(
                    if found.is_empty() {
                        "No skill content updates"
                    } else {
                        "Updates checked. Choose versions to adopt"
                    }
                    .into(),
                );
                self.updates = found;
                self.update_sources = repositories.into_values().collect();
                if self.updates.is_empty() {
                    self.update_sources.clear();
                }
            }
            Request::AdoptUpdates { ids } => {
                let selected = ids
                    .iter()
                    .map(|id| self.updates.get(id).cloned().ok_or("Update check expired"))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let repo = self.repo()?;
                let mut config = repo.config.clone();
                for (skill, folder) in selected {
                    let files = tree(&folder)?;
                    if tree_hash(&files) != skill.content_hash {
                        return Err("Content to adopt has changed. Check for updates again".into());
                    }
                    replace_snapshot(&repo.snapshot(&skill.id), &files)?;
                    copy_modes(&folder, &repo.snapshot(&skill.id))?;
                    if let Some(old) = config.library.iter_mut().find(|s| s.id == skill.id) {
                        *old = skill;
                    }
                }
                notice = Some(repo.save(config)?);
                self.plan = None;
                self.updates.clear();
                self.update_sources.clear();
            }
        }
        Ok(Response {
            state: self.view(),
            notice,
            candidates,
            preview,
            markdown,
            updates,
        })
    }
}
fn copy_modes(source: &Path, destination: &Path) -> Result<()> {
    for name in tree(source)?.keys() {
        fs::set_permissions(
            destination.join(name),
            fs::metadata(source.join(name))
                .map_err(|e| e.to_string())?
                .permissions(),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
