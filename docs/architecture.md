# Architecture

aicfg is a local desktop application. Rust manages repository operations and file application; React presents the Library, presets, rules, targets, previews, and dependency graphs.

## Source layout

| Path                                  | Responsibility                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `desktop/src/App.tsx`                 | Application navigation, native requests, dialogs, and target previews.                   |
| `desktop/src/PresetEditor.tsx`        | Preset creation, editing, and Library search.                                            |
| `desktop/src/graph.ts`                | Shared and local dependency graph construction and focus behavior.                       |
| `desktop/src/types.ts`                | TypeScript request, response, configuration, and preview interfaces.                     |
| `desktop/src-tauri/src/lib.rs`        | Tauri initialization and the structured `dispatch` command.                              |
| `desktop/src-tauri/src/domain.rs`     | Configuration models, validation, preset resolution, and stable installation naming.     |
| `desktop/src-tauri/src/engine.rs`     | Request orchestration, UI state, source adoption, and target connections.                |
| `desktop/src-tauri/src/repository.rs` | Shared and local persistence, rule bodies, and Git synchronization.                      |
| `desktop/src-tauri/src/source.rs`     | Source discovery, version fetching, metadata, and snapshot replacement.                  |
| `desktop/src-tauri/src/planner.rs`    | Desired target layout, preview generation, conflict handling, application, and rollback. |
| `desktop/src-tauri/src/files.rs`      | File operations, hashes, process execution, path guards, and managed regions.            |
| `desktop/src-tauri/tests/workflow.rs` | Core workflow and real installer integration tests.                                      |

## Native boundary

The frontend sends structured requests through one Tauri `dispatch` command. Rust returns configuration, target state, notices, and optional preview or discovery data. Blocking work runs outside the UI thread.

Git and npx are launched with argument arrays. Source URLs, repository paths, and other input are not interpolated into shell commands.

The core can be tested without Tauri by disabling default Cargo features. Enabling the default `desktop` feature includes the native runtime and dialog plugin.

## From preset to target files

1. Resolve selected presets and their references, validate identities and cycles, and deduplicate source skills.
2. Resolve skill version conflicts with explicit target choices.
3. Retrieve exact source contents and verify the adopted fingerprint.
4. Invoke `npx --yes skills@1.7.2 add ... --agent codex --yes --copy` in an isolated temporary directory.
5. Generate adapter output and compare it with current target entries.
6. Return a preview with a token and the information needed to detect later changes.
7. After confirmation, validate the preview again, apply the selected operations, and record managed fingerprints and installed versions.

The installer prepares content in isolation rather than modifying the target directly. The planner owns the final writes, ownership decisions, and instruction regions.

## Data boundaries

Shared TOML definitions and Markdown rule bodies live in the configuration repository and are committed through its Git workflow. Absolute target paths, local connections, snapshots, and installed-state records stay in `.aicfg-local/` and do not travel with shared configuration.

Target settings live in `.aicfg.toml`. Applied files remain subject to the target owner's Git workflow. aicfg never stages or commits them.

## Consistency and recovery

Configuration changes or relevant file changes invalidate an existing preview. Path checks reject unsafe relative paths and conflicting symbolic links. Managed instruction markers preserve handwritten content.

Caught write failures restore the contents from before the application. If restoration fails, the target is marked as needing repair and further application is paused. This is recovery for reported failures during a running operation; crash and power-loss recovery are not implemented.

See the [configuration reference](configuration.md) for storage details and the [architecture decisions](README.md#architecture-decisions) for key tradeoffs.
