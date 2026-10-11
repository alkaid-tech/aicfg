# Configuration reference

aicfg separates shared definitions, local application state, and target project settings. Create and edit them through the app where possible so validation and Git handling stay consistent.

## Shared configuration repository

```text
configuration/
  aicfg.toml
  rules/<rule-id>.md
  .aicfg-local/
    state.toml
    snapshots/<skill-id>/
    downloads/
```

`aicfg.toml` uses schema version `1`. Object identifiers are UUIDs, source revisions are full Git commit identifiers, and content fingerprints are SHA-256 hashes.

| Section                | Fields                                                                          | Purpose                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Root                   | `schema_version`                                                                | Configuration format version.                                                    |
| `library`              | `id`, `name`, `source`, `skill_path`, `revision`, `content_hash`, `description` | Adopted source skills and their identities, versions, and content fingerprints.  |
| `presets`              | `id`, `name`, `skills`, `rules`, `includes`                                     | Reusable combinations and references to stable object identifiers.               |
| Preset skill reference | `skill_id`, `revision`                                                          | Referenced Library skill; an empty revision follows its adopted Library version. |
| `rules`                | `id`, `name`, `paths`                                                           | Rule metadata and optional scope globs.                                          |

Rule bodies are stored separately at `rules/<rule-id>.md`, not inside the shared TOML. Renaming an object preserves its identifier and references.

For example, a rule-only preset can be represented as:

```toml
schema_version = 1
library = []

[[rules]]
id = "fe14dcca-1ae1-42e7-92b4-a7da7151c5d1"
name = "Project conventions"
paths = []

[[presets]]
id = "d070d839-aa93-4391-b59f-5e1f6e1bd05a"
name = "Development"
skills = []
rules = ["fe14dcca-1ae1-42e7-92b4-a7da7151c5d1"]
includes = []
```

Create `rules/fe14dcca-1ae1-42e7-92b4-a7da7151c5d1.md` with the rule's Markdown instructions alongside this configuration.

## Local state

`.aicfg-local/` is excluded through the configuration repository's Git exclude file. It contains local target connections and paths, managed-file fingerprints, application state, and skill snapshots. It is not committed or pushed with shared configuration.

Only the latest adopted snapshot for each skill is retained. If a required version has no matching snapshot, aicfg fetches its exact source commit and checks its contents. An unavailable version produces an error rather than silently substituting another version.

Downloads are temporary and cleaned up on normal completion, failure, or exit. Forced process termination may leave temporary files. Temporary rollback backups are separate from retained skill snapshots.

## Target project settings

Each target stores its settings in `.aicfg.toml`:

| Field      | Meaning                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `presets`  | Selected preset UUIDs.                                                                           |
| `excluded` | Skill UUIDs excluded from this target.                                                           |
| `agents`   | Enabled adapter identifiers: `agents`, `claude`, and `cursor`. All three are enabled by default. |
| `versions` | A mapping from skill UUIDs to source commit choices for this target.                             |

Example settings for the preset above:

```toml
presets = ["d070d839-aa93-4391-b59f-5e1f6e1bd05a"]
excluded = []
agents = ["agents", "claude", "cursor"]

[versions]
```

Excluding a skill leaves shared presets unchanged. During confirmed application, aicfg removes its own managed installation of an excluded skill while preserving unrelated manual content. Exclusion does not control skills an agent may read from global directories.

Tracking `.aicfg.toml`, generated skills, or rules in the target's Git repository is your choice. aicfg neither commits these files nor changes the target's ignore rules.

## Adapter output

Output depends on the adapters selected for a target:

```text
target/
  .aicfg.toml
  .agents/skills/<installation-name>/
  .agents/rules/<rule-id>.md
  AGENTS.md
  CLAUDE.md
  .claude/skills
  .claude/rules
  .cursor/rules/<rule-id>.mdc
```

The generic Agents layout uses `.agents` and `AGENTS.md`. Claude uses relative symbolic links from `.claude/skills` and `.claude/rules` to the corresponding `.agents` directories and references `AGENTS.md` from `CLAUDE.md`. Cursor rules are generated as `.mdc` files with scope metadata.

Instruction updates affect only the regions between `<!-- aicfg:begin -->` and `<!-- aicfg:end -->`. Existing handwritten content outside those regions remains intact. Existing directories that conflict with required symbolic links must be migrated manually before application.

Same-source skills are deduplicated. Different-source skills with colliding names receive preset prefixes and stable identifier suffixes; their installed `SKILL.md` names are updated to match.

## Git behavior

Saving shared definitions commits only the affected configuration paths and then attempts a push. Unrelated staged files prevent the automatic commit until you resolve them. The generated message is `feat(config): save skills and preset configuration`.

Commit and push failures preserve saved changes or local commits. A failed push pauses automatic pushing until you manually push. Target project changes always require preview and confirmation and never trigger automatic Git commits.
