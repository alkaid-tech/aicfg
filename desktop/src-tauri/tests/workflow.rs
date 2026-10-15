use aicfg_core::{
    domain::*,
    engine::{Engine, Request},
    files::*,
    planner::*,
    repository::*,
    source::*,
};
use std::{collections::BTreeMap, fs, path::Path};

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn skill(name: &str) -> Skill {
    Skill {
        id: id(),
        name: name.into(),
        source: "https://github.com/example/skills.git".into(),
        source_ref: None,
        skill_path: "skills/review".into(),
        revision: "a".repeat(40),
        content_hash: "b".repeat(64),
        description: "Code review".into(),
    }
}
fn preset(name: &str, skills: Vec<SkillRef>) -> Preset {
    Preset {
        id: id(),
        name: name.into(),
        skills,
        ..Default::default()
    }
}
fn reference(s: &Skill) -> SkillRef {
    SkillRef {
        skill_id: s.id.clone(),
        revision: String::new(),
    }
}
fn init(path: &Path) {
    fs::create_dir_all(path).unwrap();
    command(path, "git", &["init", "-b", "main"]).unwrap();
    command(path, "git", &["config", "user.name", "aicfg test"]).unwrap();
    command(
        path,
        "git",
        &["config", "user.email", "test@example.invalid"],
    )
    .unwrap();
}

#[test]
fn nested_presets_deduplicate_skills_but_preserve_direct_references() {
    let s = skill("review");
    let child = preset("Front End", vec![reference(&s)]);
    let mut parent = preset("Full Stack", vec![reference(&s)]);
    parent.includes.push(child.id.clone());
    let target = TargetConfig {
        presets: vec![parent.id.clone()],
        ..Default::default()
    };
    let config = Config {
        library: vec![s.clone()],
        presets: vec![parent, child],
        ..Default::default()
    };
    let result = resolve(&config, &target, &BTreeMap::new()).unwrap();
    assert_eq!(result.skills.len(), 1);
    assert_eq!(result.skills[0].install_name, "review");
    assert_eq!(config.presets[0].skills.len(), 1);
    assert_eq!(config.presets[1].skills.len(), 1);
}
#[test]
fn cycle_is_rejected_before_writing() {
    let mut a = preset("A", vec![]);
    let mut b = preset("B", vec![]);
    a.includes.push(b.id.clone());
    b.includes.push(a.id.clone());
    let config = Config {
        presets: vec![a, b],
        ..Default::default()
    };
    assert!(validate(&config).unwrap_err().contains("reference cycle"));
}
#[test]
fn fixed_suffixes_are_stable_when_the_preset_is_renamed() {
    let a = skill("review");
    let mut b = skill("review");
    b.source = "https://github.com/other/skills.git".into();
    let p = preset("dev", vec![reference(&a), reference(&b)]);
    let target = TargetConfig {
        presets: vec![p.id.clone()],
        ..Default::default()
    };
    let mut config = Config {
        library: vec![a, b],
        presets: vec![p],
        ..Default::default()
    };
    let before = resolve(&config, &target, &BTreeMap::new()).unwrap();
    assert_ne!(before.skills[0].install_name, before.skills[1].install_name);
    config.presets[0].name = "team".into();
    let after = resolve(&config, &target, &BTreeMap::new()).unwrap();
    for (before, after) in before.skills.iter().zip(&after.skills) {
        assert!(after.install_name.starts_with("team-review-"));
        assert_eq!(
            before.install_name.rsplit('-').next(),
            after.install_name.rsplit('-').next()
        );
        assert_eq!(before.skill.id, after.skill.id);
    }
}
#[test]
fn names_that_collide_after_length_limits_remain_unique() {
    let a = skill(&format!("{}-a", "x".repeat(30)));
    let b = skill(&format!("{}-b", "x".repeat(30)));
    let p = preset(&"p".repeat(40), vec![reference(&a), reference(&b)]);
    // Force prefixing with another source with each source name.
    let mut c = a.clone();
    c.id = id();
    let mut d = b.clone();
    d.id = id();
    let config = Config {
        library: vec![a, b, c.clone(), d.clone()],
        presets: vec![
            p.clone(),
            preset("other", vec![reference(&c), reference(&d)]),
        ],
        ..Default::default()
    };
    let target = TargetConfig {
        presets: config.presets.iter().map(|p| p.id.clone()).collect(),
        ..Default::default()
    };
    let names = resolve(&config, &target, &BTreeMap::new())
        .unwrap()
        .skills
        .into_iter()
        .map(|s| s.install_name)
        .collect::<Vec<_>>();
    assert!(names.iter().all(|n| n.len() <= 64));
    assert_eq!(
        names
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        names.len()
    );
}
#[test]
fn version_conflicts_need_a_fresh_choice_even_if_target_has_an_override() {
    let s = skill("review");
    let a = preset(
        "old",
        vec![SkillRef {
            skill_id: s.id.clone(),
            revision: "a".repeat(40),
        }],
    );
    let b = preset(
        "new",
        vec![SkillRef {
            skill_id: s.id.clone(),
            revision: "c".repeat(40),
        }],
    );
    let config = Config {
        library: vec![s.clone()],
        presets: vec![a.clone(), b.clone()],
        ..Default::default()
    };
    let target = TargetConfig {
        presets: vec![a.id, b.id],
        versions: BTreeMap::from([(s.id.clone(), "a".repeat(40))]),
        ..Default::default()
    };
    assert_eq!(
        resolve(&config, &target, &BTreeMap::new())
            .unwrap()
            .conflicts
            .len(),
        1
    );
    let result = resolve(
        &config,
        &target,
        &BTreeMap::from([(s.id.clone(), "c".repeat(40))]),
    )
    .unwrap();
    assert_eq!(result.skills[0].revision, "c".repeat(40));
}
#[test]
fn source_commit_without_content_change_does_not_mark_a_target_pending() {
    let s = skill("review");
    let p = preset("dev", vec![reference(&s)]);
    let target = TargetConfig {
        presets: vec![p.id.clone()],
        ..Default::default()
    };
    let mut config = Config {
        library: vec![s],
        presets: vec![p],
        ..Default::default()
    };
    let before = desired_signature(&config, &target).unwrap();
    config.library[0].revision = "c".repeat(40);
    assert_eq!(before, desired_signature(&config, &target).unwrap());
    config.library[0].content_hash = "d".repeat(64);
    assert_ne!(before, desired_signature(&config, &target).unwrap());
}
#[test]
fn managed_regions_preserve_handwritten_instructions() {
    let original = "# Handwritten content\nFollow my conventions.\n";
    let first = marked(original, "first").unwrap();
    let second = marked(&first, "second").unwrap();
    assert!(second.starts_with(original));
    assert!(second.contains("second"));
    assert!(!second.contains("first"));
    assert!(marked("<!-- aicfg:begin -->", "new").is_err());
}
#[test]
fn snapshots_replace_history_and_hash_ignores_source_git_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("snapshot");
    replace_snapshot(
        &path,
        &BTreeMap::from([
            ("SKILL.md".into(), b"old".to_vec()),
            ("old.txt".into(), vec![1]),
        ]),
    )
    .unwrap();
    replace_snapshot(
        &path,
        &BTreeMap::from([("SKILL.md".into(), b"new".to_vec())]),
    )
    .unwrap();
    assert!(!path.join("old.txt").exists());
    assert!(!path.with_extension("previous").exists());
    let before = tree_hash(&tree(&path).unwrap());
    fs::create_dir(path.join(".git")).unwrap();
    fs::write(path.join(".git/HEAD"), "different").unwrap();
    assert_eq!(before, tree_hash(&tree(&path).unwrap()));
}
#[test]
fn unrelated_staged_files_are_never_committed_and_retry_works() {
    let temp = tempfile::tempdir().unwrap();
    init(temp.path());
    fs::write(temp.path().join("private.txt"), "unrelated").unwrap();
    command(temp.path(), "git", &["add", "private.txt"]).unwrap();
    let mut repo = Repository::open(temp.path()).unwrap();
    let config = Config {
        presets: vec![preset("dev", vec![])],
        ..Default::default()
    };
    assert!(repo.save(config).unwrap().contains("not committed"));
    assert!(
        !command(temp.path(), "git", &["diff", "--cached", "--name-only"])
            .unwrap()
            .contains("aicfg.toml")
    );
    command(temp.path(), "git", &["rm", "--cached", "private.txt"]).unwrap();
    repo.git("commit").unwrap();
    assert!(
        command(temp.path(), "git", &["diff", "--cached", "--name-only"])
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        Repository::open(temp.path()).unwrap().config.presets.len(),
        1
    );
}
fn rule_repository() -> (tempfile::TempDir, Repository, String) {
    let temp = tempfile::tempdir().unwrap();
    let configuration = temp.path().join("configuration");
    let target_root = temp.path().join("target");
    init(&configuration);
    init(&target_root);
    fs::write(
        target_root.join("AGENTS.md"),
        "# My handwritten instructions\n",
    )
    .unwrap();
    let mut repo = Repository::open(&configuration).unwrap();
    let rule = Rule {
        id: id(),
        name: "English responses".into(),
        paths: vec!["src/**/*.tsx".into()],
        body: "Respond in English.".into(),
    };
    let mut p = preset("dev", vec![]);
    p.rules.push(rule.id.clone());
    repo.save(Config {
        presets: vec![p.clone()],
        rules: vec![rule],
        ..Default::default()
    })
    .unwrap();
    let target = Target {
        id: id(),
        name: "target".into(),
        path: target_root.to_string_lossy().into(),
        identity: "local".into(),
        ..Default::default()
    };
    let target_config = TargetConfig {
        presets: vec![p.id],
        agents: vec!["agents".into(), "cursor".into()],
        ..Default::default()
    };
    fs::write(
        target_root.join(".aicfg.toml"),
        toml::to_string(&target_config).unwrap(),
    )
    .unwrap();
    let target_id = target.id.clone();
    repo.local.targets.push(target);
    repo.local_save().unwrap();
    (temp, repo, target_id)
}
#[test]
fn rules_preview_is_read_only_and_confirmed_apply_preserves_manual_files() {
    let (_temp, mut repo, id) = rule_repository();
    let root = PathBuf::from(&repo.local.targets[0].path);
    let plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    assert!(!root.join(".agents/rules").exists());
    fs::write(root.join("notes.md"), "unmanaged").unwrap();
    plan.apply(&mut repo, &BTreeMap::new()).unwrap();
    assert!(
        read(&root.join("AGENTS.md"))
            .unwrap()
            .starts_with("# My handwritten instructions")
    );
    assert_eq!(read(&root.join("notes.md")).unwrap(), "unmanaged");
    assert!(
        fs::read_dir(root.join(".cursor/rules"))
            .unwrap()
            .next()
            .is_some()
    );
    assert!(
        !command(&root, "git", &["status", "--porcelain"])
            .unwrap()
            .contains("A  ")
    );
}
use std::path::PathBuf;
#[test]
fn stale_preview_is_rejected_before_any_target_write() {
    let (_temp, mut repo, id) = rule_repository();
    let root = PathBuf::from(&repo.local.targets[0].path);
    let plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    fs::write(root.join("AGENTS.md"), "changed after preview").unwrap();
    assert!(
        plan.apply(&mut repo, &BTreeMap::new())
            .unwrap_err()
            .contains("Preview again")
    );
    assert_eq!(
        read(&root.join("AGENTS.md")).unwrap(),
        "changed after preview"
    );
    assert!(!root.join(".agents/rules").exists());
}
#[test]
fn caught_write_failure_restores_files_from_before_the_update() {
    let (_temp, mut repo, id) = rule_repository();
    let root = PathBuf::from(&repo.local.targets[0].path);
    let mut plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    plan.changes.last_mut().unwrap().after = Entry::Link("invalid\0target".into());
    let error = plan.apply(&mut repo, &BTreeMap::new()).unwrap_err();
    assert!(error.contains("restored"));
    assert_eq!(
        read(&root.join("AGENTS.md")).unwrap(),
        "# My handwritten instructions\n"
    );
    assert!(repo.local.targets[0].managed.is_empty());
    assert!(!repo.local.targets[0].repair);
}
#[test]
fn source_discovery_uses_exact_committed_contents() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let local = temp.path().join("local");
    init(&source);
    fs::create_dir(&local).unwrap();
    fs::create_dir(source.join("review")).unwrap();
    fs::write(
        source.join("review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\n# Review\n",
    )
    .unwrap();
    command(&source, "git", &["add", "."]).unwrap();
    command(&source, "git", &["commit", "-m", "fixture"]).unwrap();
    let revision = command(&source, "git", &["rev-parse", "HEAD"]).unwrap();
    fs::write(source.join("review/SKILL.md"), "uncommitted content").unwrap();
    let found = discover(&local, &source.to_string_lossy()).unwrap();
    assert_eq!(found.candidates.len(), 1);
    assert_eq!(found.candidates[0].skill.revision, revision);
    assert!(found.candidates[0].markdown.contains("# Review"));
}
#[test]
fn root_traversal_and_existing_global_links_are_rejected() {
    assert!(safe_relative("../outside").is_err());
    assert!(normalize_source("--upload-pack=evil").is_err());
    #[cfg(unix)]
    {
        let temp = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/private/tmp", temp.path().join(".agents")).unwrap();
        assert!(guard_ancestors(temp.path(), ".agents/skills/review/SKILL.md").is_err());
    }
}
#[test]
fn deletion_checks_known_target_references() {
    let (_temp, repo, id) = rule_repository();
    let preset_id = repo.config.presets[0].id.clone();
    let mut engine = Engine::new(None);
    engine.repo = Some(repo);
    assert!(
        engine
            .execute(Request::Delete {
                kind: "preset".into(),
                id: preset_id
            })
            .err()
            .unwrap()
            .contains("still uses")
    );
    engine.execute(Request::RemoveTarget { id }).unwrap();
    assert_eq!(engine.repo.unwrap().config.presets.len(), 1);
}

#[test]
#[ignore = "runs the real npx skills installer; requires Node and npm access/cache"]
fn real_installer_roundtrip_preview_apply_drift_and_update() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let configuration = temp.path().join("configuration");
    let target = temp.path().join("consumer");
    init(&source);
    init(&configuration);
    init(&target);
    fs::create_dir(source.join("review")).unwrap();
    let source_text =
        "---\nname: review\ndescription: Review test code\n---\n# Review\nAdopted v1.\n";
    fs::write(source.join("review/SKILL.md"), source_text).unwrap();
    fs::write(source.join("review/check.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            source.join("review/check.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    command(&source, "git", &["add", "."]).unwrap();
    command(&source, "git", &["commit", "-m", "fixture"]).unwrap();
    let mut engine = Engine::new(None);
    engine
        .execute(Request::Open {
            path: configuration.to_string_lossy().into(),
        })
        .unwrap();
    let candidates = engine
        .execute(Request::Inspect {
            source: source.to_string_lossy().into(),
        })
        .unwrap()
        .candidates
        .unwrap();
    let skill_id = candidates[0].skill.id.clone();
    engine
        .execute(Request::Favorite {
            ids: vec![skill_id.clone()],
        })
        .unwrap();
    assert_eq!(
        fs::read_dir(configuration.join(".aicfg-local/downloads"))
            .unwrap()
            .count(),
        0
    );
    let mut config = engine.repo.as_ref().unwrap().config.clone();
    let p = preset("dev", vec![reference(&config.library[0])]);
    let preset_id = p.id.clone();
    config.presets.push(p);
    engine.execute(Request::Save { config }).unwrap();
    let response = engine
        .execute(Request::AddTarget {
            path: target.to_string_lossy().into(),
        })
        .unwrap();
    let target_id = response.state.targets[0].target.id.clone();
    engine
        .execute(Request::SaveTarget {
            id: target_id.clone(),
            config: TargetConfig {
                presets: vec![preset_id],
                agents: default_agents(),
                ..Default::default()
            },
        })
        .unwrap();
    let cold_start = std::time::Instant::now();
    let preview = engine
        .execute(Request::Preview {
            id: target_id.clone(),
            choices: BTreeMap::new(),
        })
        .unwrap()
        .preview
        .unwrap();
    let cold_elapsed = cold_start.elapsed();
    let warm_start = std::time::Instant::now();
    // Reopen the repository to verify reuse across application sessions.
    engine.repo = Some(Repository::open(&configuration).unwrap());
    let cached_preview = engine
        .execute(Request::Preview {
            id: target_id.clone(),
            choices: BTreeMap::new(),
        })
        .unwrap()
        .preview
        .unwrap();
    println!(
        "Preview timing: cold {:?}, cached {:?}",
        cold_elapsed,
        warm_start.elapsed()
    );
    assert_eq!(
        serde_json::to_value(&preview.changes).unwrap(),
        serde_json::to_value(&cached_preview.changes).unwrap()
    );
    let preview = cached_preview;
    assert!(!target.join(".agents/skills").exists());
    assert!(
        preview
            .changes
            .iter()
            .any(|c| c.path == ".agents/skills/review/SKILL.md")
    );
    engine
        .execute(Request::Apply {
            token: preview.token,
            decisions: BTreeMap::new(),
        })
        .unwrap();
    assert_eq!(
        engine.execute(Request::State).unwrap().state.targets[0].status,
        "Synced"
    );
    assert_eq!(
        engine.repo.as_ref().unwrap().local.targets[0].installed[0].revision,
        candidates[0].skill.revision
    );
    assert_eq!(
        Repository::open(&configuration).unwrap().local.targets[0].installed[0]
            .skill
            .id,
        skill_id
    );
    assert_eq!(
        fs::read_link(target.join(".claude/skills")).unwrap(),
        PathBuf::from("../.agents/skills")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_ne!(
            fs::metadata(target.join(".agents/skills/review/check.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }
    let installed = target.join(".agents/skills/review/SKILL.md");
    fs::write(&installed, "manual edit").unwrap();
    assert_eq!(
        engine.execute(Request::State).unwrap().state.targets[0].status,
        "Local changes"
    );
    let preview = engine
        .execute(Request::Preview {
            id: target_id.clone(),
            choices: BTreeMap::new(),
        })
        .unwrap()
        .preview
        .unwrap();
    assert!(
        preview
            .changes
            .iter()
            .any(|c| c.before == "manual edit" && c.after.contains("Adopted v1"))
    );
    engine.plan = None;
    assert_eq!(read(&installed).unwrap(), "manual edit");
    fs::write(source.join("unrelated.txt"), "new repository commit").unwrap();
    command(&source, "git", &["add", "."]).unwrap();
    command(&source, "git", &["commit", "-m", "unrelated"]).unwrap();
    assert!(
        engine
            .execute(Request::CheckUpdates)
            .unwrap()
            .updates
            .unwrap()
            .is_empty()
    );
    fs::write(
        source.join("review/SKILL.md"),
        source_text.replace("v1", "v2"),
    )
    .unwrap();
    command(&source, "git", &["add", "."]).unwrap();
    command(&source, "git", &["commit", "-m", "updated skill"]).unwrap();
    assert_eq!(
        engine
            .execute(Request::CheckUpdates)
            .unwrap()
            .updates
            .unwrap()
            .len(),
        1
    );
    engine
        .execute(Request::AdoptUpdates {
            ids: vec![skill_id.clone()],
        })
        .unwrap();
    assert!(
        read(&configuration.join(format!(".aicfg-local/snapshots/{skill_id}/SKILL.md")))
            .unwrap()
            .contains("v2")
    );
    assert_eq!(
        fs::read_dir(configuration.join(".aicfg-local/downloads"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(read(&installed).unwrap(), "manual edit");
    let preview = engine
        .execute(Request::Preview {
            id: target_id,
            choices: BTreeMap::new(),
        })
        .unwrap()
        .preview
        .unwrap();
    engine
        .execute(Request::Apply {
            token: preview.token,
            decisions: BTreeMap::new(),
        })
        .unwrap();
    assert!(read(&installed).unwrap().contains("v2"));
}

#[test]
fn unmanaged_rule_takeover_preserves_contents_then_becomes_managed() {
    let (_temp, mut repo, id) = rule_repository();
    let root = PathBuf::from(&repo.local.targets[0].path);
    let path = format!(".agents/rules/{}.md", repo.config.rules[0].id);
    atomic_write(&root.join(&path), b"handwritten rule").unwrap();
    let plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    assert!(plan.changes.iter().any(|c| c.path == path && c.conflict));
    plan.apply(
        &mut repo,
        &BTreeMap::from([(path.clone(), "takeover".into())]),
    )
    .unwrap();
    assert_eq!(read(&root.join(&path)).unwrap(), "handwritten rule");
    assert!(repo.local.targets[0].managed.contains_key(&path));
    let plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    assert!(plan.changes.iter().any(|c| c.path == path && !c.conflict));
}
#[test]
fn source_relocation_keeps_identity_and_records_the_new_repositories_commit() {
    let temp = tempfile::tempdir().unwrap();
    let configuration = temp.path().join("configuration");
    let source = temp.path().join("source");
    init(&configuration);
    init(&source);
    fs::create_dir(source.join("review")).unwrap();
    fs::write(
        source.join("review/SKILL.md"),
        "---\nname: review\ndescription: new source\n---\nrelocated\n",
    )
    .unwrap();
    command(&source, "git", &["add", "."]).unwrap();
    command(&source, "git", &["commit", "-m", "fixture"]).unwrap();
    let s = skill("review");
    let p = preset("dev", vec![reference(&s)]);
    let mut repo = Repository::open(&configuration).unwrap();
    repo.save(Config {
        library: vec![s.clone()],
        presets: vec![p],
        ..Default::default()
    })
    .unwrap();
    let mut engine = Engine::new(None);
    engine.repo = Some(repo);
    let response = engine
        .execute(Request::RelocateSource {
            id: s.id.clone(),
            source: source.to_string_lossy().into(),
            skill_path: "review".into(),
        })
        .unwrap();
    assert_eq!(response.state.config.library[0].id, s.id);
    assert_eq!(response.state.config.presets[0].skills[0].skill_id, s.id);
    assert_eq!(
        response.state.config.library[0].revision,
        command(&source, "git", &["rev-parse", "HEAD"]).unwrap()
    );
    assert!(
        engine
            .execute(Request::ReadSkill { id: s.id })
            .unwrap()
            .markdown
            .unwrap()
            .contains("relocated")
    );
}
#[test]
fn modifying_an_unchanged_managed_file_after_preview_invalidates_the_plan() {
    let (_temp, mut repo, id) = rule_repository();
    Plan::build(&mut repo, &id, BTreeMap::new())
        .unwrap()
        .apply(&mut repo, &BTreeMap::new())
        .unwrap();
    let plan = Plan::build(&mut repo, &id, BTreeMap::new()).unwrap();
    assert!(plan.changes.is_empty());
    let root = PathBuf::from(&repo.local.targets[0].path);
    fs::write(root.join("AGENTS.md"), "edited after preview").unwrap();
    assert!(
        plan.apply(&mut repo, &BTreeMap::new())
            .unwrap_err()
            .contains("Preview again")
    );
}

#[test]
fn preview_and_apply_report_progress_at_the_actual_work_stages() {
    use std::cell::RefCell;
    let (_temp, mut repo, id) = rule_repository();
    let root = PathBuf::from(&repo.local.targets[0].path);
    let messages = RefCell::new(Vec::new());
    let progress = |message: &str| messages.borrow_mut().push(message.to_string());
    let plan = Plan::build_with_progress(&mut repo, &id, BTreeMap::new(), &progress).unwrap();
    assert_eq!(
        messages.borrow()[0],
        "Resolving saved presets and skill versions"
    );
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| m == "Generating rules and comparing target files")
    );
    assert!(!root.join(".agents/rules").exists());
    messages.borrow_mut().clear();
    plan.apply_with_progress(&mut repo, &BTreeMap::new(), &progress)
        .unwrap();
    assert_eq!(
        messages.borrow()[0],
        "Validating preview before applying changes"
    );
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| m.starts_with("Applying file change: "))
    );
}
