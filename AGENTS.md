# Project Rules

## Language

- Use English for all project content, including code identifiers, comments,
  documentation, user-facing text, logs, error messages, and test descriptions.
- Use English for commit messages and pull request titles and descriptions.
- Preserve proper names, external data, and non-English text when it is required
  by a feature or test case.

## Semantic Commit Messages

Use the following format:

```text
<type>[optional scope][!]: <summary>
```

- Use one of these types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `chore`, or `revert`.
- Use a scope when it helps identify the affected component or area.
- Write a concise, imperative summary in English, without a trailing period.
- Use `!` for breaking changes and explain the change and required migration in
  the commit body with a `BREAKING CHANGE:` footer.
- Add a commit body when context, rationale, or migration details are needed.

Examples:

```text
feat(config): add profile inheritance
fix(cli): handle missing configuration files
docs: document the contribution workflow
```

## Commit Grouping

- Review all pending changes before committing and group them by logical purpose.
- Each commit must contain one cohesive change. Include its directly related
  tests, documentation, and configuration updates in the same commit.
- Commit unrelated features, fixes, refactors, formatting changes, and
  documentation updates separately.
- Group changes by their relationship, not merely by file or directory. Stage
  individual files or hunks when necessary to keep each commit focused.
- Review the staged diff before each commit to ensure it matches the commit
  message and excludes unrelated changes.
- Do not include pre-existing changes from other work unless explicitly asked.
