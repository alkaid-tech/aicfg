# Documentation

aicfg manages agent skills and rules through reusable presets. Its shared configuration belongs to you and lives in your Git repository; installations are applied to target projects only after you review and confirm them.

## Get started

- [Development setup](development.md): prerequisites, running the app, building, and verification.
- [User guide](usage.md): connect repositories, collect skills, compose presets, and apply updates.
- [Configuration reference](configuration.md): shared files, local state, target settings, and adapter output.
- [Glossary](../GLOSSARY.md): the terms used throughout the project.

## Understand and contribute

- [Architecture](architecture.md): modules and the preview-to-application workflow.
- [Contributing](../CONTRIBUTING.md): issues, pull requests, commits, and licensing.
- [Roadmap and limitations](roadmap.md): supported behavior and planned work.

## Architecture decisions

- [ADR 0001: Keep skill snapshots local](adr/0001-local-skill-snapshots.md)
- [ADR 0002: Use Tauri 2 and React](adr/0002-desktop-runtime.md)

The guides describe current behavior. Future features and design questions are tracked separately in the roadmap.
