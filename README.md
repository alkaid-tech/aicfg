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

The current implementation uses Rust, Tauri 2, React, and TypeScript. macOS is the supported desktop platform for this first release. See the [roadmap](docs/roadmap.md) for remaining work and current limitations.

## Run locally

You need macOS, Xcode Command Line Tools, Rust stable, Node.js 22.12 or newer, and Git. The application needs `git` and `npx` on `PATH`; its first skill installation may require network access.

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

The macOS bundle is generated at `desktop/src-tauri/target/release/bundle/macos/aicfg.app`. Formal signing and distribution are planned.

## First use

1. Connect, initialize, or clone a configuration repository in its own directory.
2. Add skills to the Library from a GitHub URL, `owner/repo`, or a local Git repository.
3. Create a preset, then add skills, rules, and any included presets on its detail page.
4. Add a target project, select presets and adapters, and save its configuration.
5. Preview the file changes, resolve any conflicts, and confirm the application.

Shared configuration is committed and pushed when it is saved. Changes to target project repositories are never staged or committed by aicfg.

## Documentation

Start with the [documentation index](docs/README.md), or jump to:

- [Development setup](docs/development.md)
- [User guide](docs/usage.md)
- [Configuration reference](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Roadmap and limitations](docs/roadmap.md)
- [Glossary](GLOSSARY.md)

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification commands, and contribution guidelines.

## License

Licensed under the [Apache License 2.0](LICENSE).
