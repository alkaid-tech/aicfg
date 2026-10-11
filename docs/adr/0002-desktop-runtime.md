# ADR 0002: Use Tauri 2 and React

Status: Accepted.

## Context

The macOS application needs local Git access, process execution, Markdown rendering, interactive dependency graphs, and controlled writes to target projects.

## Decision

Use Tauri 2 with Rust for TOML persistence, Git operations, source snapshots, preset resolution, previews, and application. Use React and TypeScript for the interface, Vite for development and asset builds, react-markdown with remark-gfm for Markdown, and React Flow for dependency graphs.

Expose native functionality through one structured `dispatch` command and move blocking work away from the UI thread. Launch Git and npx with argument arrays rather than interpolated shell commands.

Pin skill installation to `skills@1.7.2`. Install in project-level copy mode inside an isolated temporary directory, then let aicfg's planner write the confirmed target changes.

## Consequences

Development requires both Rust and Node.js. The runtime currently also depends on local Git and npx. Executable path settings, formal signing, and distribution remain future work.

This decision establishes the first macOS workflow. It does not add other desktop platforms or dynamic loading of third-party adapters.

## References

- [Tauri: Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)
- [Tauri: Vite integration](https://v2.tauri.app/start/frontend/vite/)
- [React Flow documentation](https://reactflow.dev/learn)
- [skills source repository](https://github.com/vercel-labs/skills)
