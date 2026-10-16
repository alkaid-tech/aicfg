# aicfg

A local-first macOS desktop app for managing agent skills, rules, and reusable presets across your repositories.

Keep shared configuration in your own Git repository. Collect skills in a Library, combine them into presets, then preview and confirm changes before applying them to a target project.

## What you can do

- Discover skills from GitHub or local Git repositories and adopt specific source versions.
- Compose presets from skills, Markdown rules, and other presets, with cycle detection.
- Search your Library and explore shared preset and local target project dependency graphs.
- Choose agent adapters and exclude skills separately for each target project.
- Preview file changes, resolve version and ownership conflicts, and preserve handwritten instructions.
- Track installed versions, local edits, pending updates, and repair states.
- Save, commit, and push shared configuration using your existing Git identity and authentication.
- Use the interface in English, Simplified Chinese, or Japanese, or follow your system language from Settings.

The current implementation uses Rust, Tauri 2, React, and TypeScript. macOS is the supported desktop platform for this first release. See the [roadmap](docs/roadmap.md) for remaining work and current limitations.

## Run locally

You need macOS, Xcode Command Line Tools, Rust stable, Node.js 22.12 or newer with npm/npx, and Git. The application discovers your shell's `PATH` when launched from Finder; its first skill installation may require network access.

```sh
git clone https://github.com/alkaid-tech/aicfg.git
cd aicfg/desktop
npm ci
npm run desktop
```

`npm run dev` starts only the browser interface. Connecting repositories and applying changes require the Tauri desktop runtime.

To build a local application bundle:

```sh
cd desktop
npm run bundle
```

The macOS bundle is generated at `desktop/src-tauri/target/release/bundle/macos/aicfg.app`. The [release workflow](docs/releases.md) automatically proposes versions and publishes macOS Universal downloads after the release PR is merged. With all Apple signing credentials configured, downloads are Developer ID signed and notarized. Until then, releases are explicitly labeled unsigned previews and may be blocked by Gatekeeper. Local bundles require separate signing setup for distribution.

## First use

1. Connect, initialize, or clone a configuration repository in its own directory.
2. Add skills to the Library from a GitHub URL, `owner/repo`, or a local Git repository.
3. Create a preset, then add skills, rules, and any included presets on its detail page.
4. Add a target project, select presets and adapters, then click **Save and preview changes**.
5. Review the file changes, resolve any conflicts, then click **Confirm and apply changes**.

Preview reads the saved target configuration and compares the desired skills, rules, and adapters with existing files. It reuses prepared skill caches when possible; uncached skills run through the installer in a temporary directory under the configuration repository's ignored local data. Source fetching and first-time preparation can take time. Preview does not create a Git worktree or apply files to the target project. The activity log shows preparation and application stages, including the current skill or file. Empty selections and previews without file changes are explained in the interface.

The installed application version appears in the sidebar and Settings.

Shared configuration is committed and pushed when it is saved. Changes to target project repositories are never staged or committed by aicfg.

## Documentation

Start with the [documentation index](docs/README.md), or jump to:

- [Development setup](docs/development.md)
- [Release workflow and version policy](docs/releases.md)
- [User guide](docs/usage.md)
- [Configuration reference](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Roadmap and limitations](docs/roadmap.md)
- [Glossary](GLOSSARY.md)

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification commands, and contribution guidelines.

## License

Licensed under the [Apache License 2.0](LICENSE).
