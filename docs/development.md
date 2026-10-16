# Development setup

## Prerequisites

For the desktop application, use macOS with:

- Xcode Command Line Tools, installed with `xcode-select --install`.
- Rust stable and Cargo.
- Node.js 22.12 or newer, with npm and npx.
- Git, with an identity configured for configuration repository commits.

Private repository access uses your existing Git authentication. At runtime, Git and Node.js (including npm/npx) must be installed locally. Skill installation uses the pinned `skills@1.7.2` CLI.

## Start the desktop app

From the repository root:

```sh
cd desktop
npm ci
npm run desktop
```

Tauri starts the Vite development server and the native application. `npm run dev` starts the browser UI alone; native repository operations are available only in the desktop app.

Use separate temporary Git repositories for development data and target projects when testing file application.

## Build

Build the frontend:

```sh
cd desktop
npm run build
```

Build a local macOS bundle:

```sh
cd desktop
npm run bundle
```

The bundle is written to `desktop/src-tauri/target/release/bundle/macos/aicfg.app`. For a debug bundle:

```sh
cd desktop
npm run tauri -- build --debug
open src-tauri/target/debug/bundle/macos/aicfg.app
```

### Runtime executable discovery

The application does not bundle Node.js. On macOS, aicfg reads `PATH` from your interactive login shell on the first external command, then reuses it for Git, npx, and their child processes. This allows Finder launches to use Node.js configured through Homebrew, nvm, fnm, Volta, asdf, or mise. Shell startup runs in your home directory with a five-second timeout; shell startup messages are ignored. If it fails or times out, aicfg keeps its inherited paths and adds common Homebrew and version-manager directories, plus the system paths.

The discovered path is passed only to child processes. Repository paths and arguments are never interpolated into the shell probe. Empty and relative path entries are excluded so a target repository cannot supply a runtime executable through the current directory.

If npx is still unavailable, verify `node --version` and `npx --version` in a new terminal. Install Node.js 22.12 or newer with npm if needed, or fix your shell's Node.js initialization, then quit and reopen aicfg. Restart the application after changing Node.js versions or shell configuration. Unusual installation paths must be added to your shell's `PATH`; runtime executable path settings are not available yet.

Local bundles are not automatically signed with a Developer ID or notarized. See the [release guide](releases.md#apple-signing-and-notarization) for signed distribution builds.

## Verification

Run frontend tests and type checking/build:

```sh
cd desktop
npm test
npm run build
```

Run Rust formatting, core tests, linting, and desktop compilation checks:

```sh
cd desktop/src-tauri
cargo fmt --all --check
cargo test --locked --no-default-features
cargo clippy --locked --all-targets --no-default-features -- -D warnings
cargo check --locked
```

The real installer integration test is opt-in. It creates temporary configuration, source, and target repositories and invokes npx. The first run may need network access; cached installations can run offline.

```sh
cd desktop/src-tauri
cargo test --locked --no-default-features real_installer_roundtrip -- --ignored
```

The GitHub Actions workflow runs frontend verification with Node.js 22 on Ubuntu 24.04 and Rust core plus desktop checks on macOS 26 (arm64). Runner OS versions are pinned to avoid automatic image migrations.

CI also checks that the application manifests and lockfiles have matching versions. See the [release guide](releases.md) for automatic versioning and Universal macOS packaging.
