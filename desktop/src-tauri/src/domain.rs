use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub library: Vec<Skill>,
    #[serde(default)]
    pub presets: Vec<Preset>,
    #[serde(default)]
    pub rules: Vec<Rule>,
}
fn schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    pub skill_path: String,
    pub revision: String,
    pub content_hash: String,
    #[serde(default)]
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillRef {
    pub skill_id: String,
    #[serde(default)]
    pub revision: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Preset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skills: Vec<SkillRef>,
    #[serde(default)]
    pub rules: Vec<String>,
    #[serde(default)]
    pub includes: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Rule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub body: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TargetConfig {
    #[serde(default)]
    pub presets: Vec<String>,
    #[serde(default)]
    pub excluded: Vec<String>,
    #[serde(default = "default_agents")]
    pub agents: Vec<String>,
    #[serde(default)]
    pub versions: BTreeMap<String, String>,
}
pub fn default_agents() -> Vec<String> {
    vec!["agents".into(), "claude".into(), "cursor".into()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedSkill {
    pub skill: Skill,
    pub revision: String,
    pub install_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Resolution {
    pub skills: Vec<ResolvedSkill>,
    pub rules: Vec<Rule>,
    pub conflicts: BTreeMap<String, Vec<String>>,
}

pub fn slug(name: &str) -> String {
    let value = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if value.is_empty() {
        "skill".into()
    } else {
        value.chars().take(40).collect()
    }
}

pub fn resolve(
    config: &Config,
    target: &TargetConfig,
    choices: &BTreeMap<String, String>,
) -> Result<Resolution> {
    struct Walker<'a> {
        config: &'a Config,
        stack: Vec<String>,
        seen: BTreeSet<String>,
        owners: BTreeMap<String, (String, String)>,
        versions: BTreeMap<String, BTreeSet<String>>,
        rules: BTreeSet<String>,
    }
    impl Walker<'_> {
        fn visit(&mut self, id: &str) -> Result<()> {
            if let Some(pos) = self.stack.iter().position(|v| v == id) {
                let names = self.stack[pos..]
                    .iter()
                    .chain(std::iter::once(&id.to_string()))
                    .map(|id| {
                        self.config
                            .presets
                            .iter()
                            .find(|p| p.id == *id)
                            .map(|p| p.name.clone())
                            .unwrap_or(id.clone())
                    })
                    .collect::<Vec<_>>();
                return Err(format!("Preset reference cycle: {}", names.join(", ")));
            }
            if self.seen.contains(id) {
                return Ok(());
            }
            let preset = self
                .config
                .presets
                .iter()
                .find(|p| p.id == id)
                .ok_or_else(|| {
                    format!(
                        "Preset has been deleted or does not exist: {id}. Choose another preset"
                    )
                })?;
            self.stack.push(id.into());
            for reference in &preset.skills {
                let skill = self
                    .config
                    .library
                    .iter()
                    .find(|s| s.id == reference.skill_id)
                    .ok_or_else(|| format!("{} references a missing skill", preset.name))?;
                let revision = if reference.revision.is_empty() {
                    &skill.revision
                } else {
                    &reference.revision
                };
                self.versions
                    .entry(skill.id.clone())
                    .or_default()
                    .insert(revision.clone());
                let owner = (preset.id.clone(), preset.name.clone());
                self.owners
                    .entry(skill.id.clone())
                    .and_modify(|v| {
                        if owner.0 < v.0 {
                            *v = owner.clone()
                        }
                    })
                    .or_insert(owner);
            }
            for id in &preset.rules {
                if !self.config.rules.iter().any(|r| r.id == *id) {
                    return Err(format!("{} references a missing rule", preset.name));
                }
                self.rules.insert(id.clone());
            }
            for child in &preset.includes {
                self.visit(child)?;
            }
            self.stack.pop();
            self.seen.insert(id.into());
            Ok(())
        }
    }
    let mut w = Walker {
        config,
        stack: vec![],
        seen: BTreeSet::new(),
        owners: BTreeMap::new(),
        versions: BTreeMap::new(),
        rules: BTreeSet::new(),
    };
    for id in &target.presets {
        w.visit(id)?;
    }
    let mut result = Resolution::default();
    let mut counts = BTreeMap::new();
    for id in w.versions.keys().filter(|id| !target.excluded.contains(id)) {
        let skill = config.library.iter().find(|s| s.id == *id).unwrap();
        *counts.entry(slug(&skill.name)).or_insert(0usize) += 1;
    }
    for (id, versions) in &w.versions {
        if target.excluded.contains(id) {
            continue;
        }
        let skill = config.library.iter().find(|s| s.id == *id).unwrap().clone();
        let revision = if let Some(value) = choices.get(id) {
            if !versions.contains(value) {
                return Err(format!(
                    "The selected version for {} is not required by its presets",
                    skill.name
                ));
            }
            value.clone()
        } else if versions.len() > 1 {
            result
                .conflicts
                .insert(id.clone(), versions.iter().cloned().collect());
            continue;
        } else {
            versions.iter().next().unwrap().clone()
        };
        let base = slug(&skill.name);
        let install_name = if counts.get(&base).copied().unwrap_or(0) > 1 {
            format!("{}-{}", slug(&w.owners[id].1), base)
        } else {
            base
        };
        result.skills.push(ResolvedSkill {
            skill,
            revision,
            install_name: install_name.chars().take(64).collect(),
        });
    }
    let mut name_counts = BTreeMap::new();
    for item in &result.skills {
        *name_counts
            .entry(item.install_name.clone())
            .or_insert(0usize) += 1;
    }
    for item in &mut result.skills {
        // Full stable identity avoids suffix collisions and stays unchanged across revisions.
        let suffix = item.skill.id.replace('-', "");
        if name_counts[&item.install_name] > 1 {
            item.install_name = format!(
                "{}-{}",
                item.install_name.chars().take(25).collect::<String>(),
                suffix
            );
        } else {
            item.install_name = item.install_name.chars().take(64).collect();
        }
    }
    result.rules = config
        .rules
        .iter()
        .filter(|r| w.rules.contains(&r.id))
        .cloned()
        .collect();
    Ok(result)
}

pub fn validate(config: &Config) -> Result<()> {
    if config.schema_version > 1 {
        return Err("This configuration uses a newer version. Upgrade aicfg".into());
    }
    let mut ids = BTreeSet::new();
    for (id, name) in config
        .library
        .iter()
        .map(|s| (&s.id, &s.name))
        .chain(config.presets.iter().map(|p| (&p.id, &p.name)))
        .chain(config.rules.iter().map(|r| (&r.id, &r.name)))
    {
        if uuid::Uuid::parse_str(id).is_err() || !ids.insert(id) {
            return Err("Invalid or duplicate object identifier".into());
        }
        if name.trim().is_empty() {
            return Err("Name must not be empty".into());
        }
    }
    for preset in &config.presets {
        for reference in &preset.skills {
            if !reference.revision.is_empty()
                && (reference.revision.len() != 40
                    || !reference.revision.chars().all(|c| c.is_ascii_hexdigit()))
            {
                return Err("A pinned version requires a full source commit identifier".into());
            }
        }
        resolve(
            config,
            &TargetConfig {
                presets: vec![preset.id.clone()],
                ..Default::default()
            },
            &BTreeMap::new(),
        )?;
    }
    for skill in &config.library {
        if skill.skill_path != "." {
            crate::files::safe_relative(&skill.skill_path)?;
        }
        if skill.name.contains(['/', '\\']) || skill.name == "." || skill.name == ".." {
            return Err("Invalid skill name".into());
        }
        if skill.revision.len() != 40 || !skill.revision.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid source commit identifier".into());
        }
        if skill.content_hash.len() != 64
            || !skill.content_hash.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Invalid skill content fingerprint".into());
        }
    }
    Ok(())
}
