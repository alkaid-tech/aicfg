# Roadmap and limitations

The current release provides a working local workflow from collecting skills to previewing and applying them. This page separates available behavior from planned work; items below are not delivery commitments.

## Available today

- A macOS desktop runtime using Rust, Tauri 2, React, and TypeScript.
- GitHub HTTPS and local Git skill sources, exact source versions, and content fingerprints.
- A Library, composable presets, scoped Markdown rules, and cycle detection.
- Shared preset and local target dependency graphs with click-to-focus navigation.
- Generic Agents, Claude, and Cursor adapters.
- Per-target skill exclusions and explicit version conflict choices.
- File previews, managed instruction regions, ownership decisions, and caught-failure rollback.
- Configuration Git commits, push handling, manual sync, and reload.

## Planned improvements

- Display aliases that remain separate from installation names and identities.
- Batch review and confirmation for multiple target projects.
- Dependency graph highlighting for change propagation and excluded skills.
- Guided migration of existing Claude directories to the adapter's symbolic link layout.
- Runtime executable path configuration and a clearer packaged runtime experience.
- Signed macOS releases and distribution guidance.

## Current limitations

- Desktop support is limited to macOS. Windows and Linux desktop support are future work.
- One local directory can be connected per target repository.
- Skill update checks are manual; there are no scheduled background checks.
- Targets are previewed and confirmed separately; batch application is not available.
- File changes are displayed as current and desired contents for each file.
- Only the latest adopted skill snapshot is retained. Fetching older versions depends on source availability.
- Missing references on other devices or in unconnected targets cannot be discovered by local deletion checks.
- Rule semantics and an agent's actual enforcement of scope are left to the user and agent. aicfg does not resolve contradictory rule instructions.
- Existing directories that conflict with adapter links require manual migration.
- Git merge conflicts are resolved with external Git tools.
- Repair after failed rollback is manual. Automatic crash or power-loss recovery is not implemented.
- Third-party adapter installation, dynamic plugin loading, online rule imports, and team permission management are outside the first release.

## Design questions for future work

Future work needs to define alias ownership and display, multi-target review interactions, runtime discovery, adapter migration, and reliable restart recovery. Shared and target configuration migrations should be specified before changing their schemas.

Open an issue before implementing substantial changes to these behaviors. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution process.
