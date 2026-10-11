# Contributing to aicfg

Thank you for helping improve aicfg. Contributions can include bug reports, documentation corrections, tests, and implementation changes.

## Before you start

Read the [development setup](docs/development.md), [architecture](docs/architecture.md), and [project rules](AGENTS.md). Check the [roadmap](docs/roadmap.md) before starting a substantial feature, and open an issue to discuss changes that alter configuration formats or application behavior.

Use English for project content, issues, pull requests, and commit messages. Preserve external content when it is required by a feature or test.

## Report a bug

Include your macOS version, Node.js and Rust versions, the steps to reproduce, the expected behavior, and the actual result. Use a minimal configuration or test repository when possible. Remove credentials and private repository content from any logs or examples you share.

## Make a change

1. Fork the repository and create a branch for your change.
2. Make a focused change, including directly related tests and documentation.
3. Run the relevant [verification commands](docs/development.md#verification).
4. Open a pull request explaining the problem, resulting behavior, and checks you ran.

Preserve the distinction between shared configuration, local application state, and target project files. Changes that write to target projects must retain the preview and confirmation flow, ownership checks, and failure recovery behavior.

## Commits

Use Semantic Commit Messages:

```text
<type>[optional scope][!]: <summary>
```

Write a concise, imperative summary in English. For example:

```text
feat(presets): add skill search filters
fix(planner): reject previews after target files change
docs: clarify configuration repository setup
```

Group changes by logical purpose. Keep directly related implementation, tests, and documentation together; commit unrelated work separately. Explain breaking changes and migration requirements in a `BREAKING CHANGE:` footer.

## Licensing

aicfg is licensed under Apache-2.0. Contributions submitted for inclusion follow that license unless explicitly stated otherwise, as described in its contribution terms. Include the applicable license and attribution when adding third-party code or assets.
