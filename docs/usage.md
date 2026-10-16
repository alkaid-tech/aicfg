# User guide

## Connect a configuration repository

A configuration repository stores your Library, presets, and rule definitions. Keep it in a different directory from every target project.

From the welcome screen, connect an existing Git repository or set up a repository in an empty directory. You can initialize a local repository or clone a remote one. Git identity and authentication come from your system Git configuration.

Saving shared configuration also creates a local commit and attempts to push it. The configuration repository is separate from the repositories where you apply skills and rules.

## Build your Library

Choose **Add skills to Library** and enter a GitHub URL, `owner/repo`, or an absolute path to a local Git repository. Discover the available skills, read their documentation, and select the ones you want to collect.

To collect skills from one directory, use a GitHub tree URL such as `https://github.com/owner/repo/tree/main/docs/skills`. Discovery only scans that directory, while stored skill paths remain relative to the repository root. The selected branch or tag is retained for update checks; adopted versions remain pinned to full commit identifiers. Encode a slash in a branch name as `%2F`.

Discovery skips all directories whose names start with `.`, including agent installation directories such as `.agents`, `.claude`, and `.cursor`. To import a hidden directory intentionally, enter its GitHub tree URL, for example `https://github.com/owner/repo/tree/main/.agents/skills`. The explicitly selected directory is scanned; hidden directories beneath it remain excluded. Discovery stops at each skill directory, so nested `SKILL.md` reference copies are kept as content rather than listed as separate skills. All skill content, including hidden reference files, is preserved.

Discovery reads committed source contents. A repository may contain several skills; you choose individual skills rather than automatically collecting everything. Adding a skill to the Library does not install it into a target project.

You can change a skill's source repository or directory while retaining its identity and preset references. Check for updates and preview target changes before applying content from the new location.

## Create rules and presets

Create a rule with a name and Markdown body. Leave its scope empty for the entire target project, or add file globs such as `src/**/*.tsx`.

Create a preset by entering its name. On its detail page, search the Library to add skills, select rules, and include other presets. Save the related changes together. A skill can follow the adopted Library version or use a full source commit identifier.

Preset references are retained rather than copied. Changes to an included preset affect the effective configuration of its parents. Cyclic references are rejected, and deleting an item requires removing its known references first.

## Add a target project

Choose the root of a development Git repository. Select the presets it should use, enable adapters, and optionally exclude skills. Save the target configuration before previewing changes.

The first release supports one local directory per target repository. The target's `.aicfg.toml` can be shared through its own Git workflow; aicfg does not stage or commit target files.

## Preview and apply

Choose **Preview changes** to compare current and desired file contents. Resolve any version conflicts first. If unmanaged files conflict with desired output, choose one of:

- **Take ownership and keep current content**: retain the existing content and begin tracking it. Different content remains pending for a later update.
- **Replace with preset content**: write the desired content and manage it thereafter.
- **Skip this time**: preserve the unmanaged content. Skipping any conflicting file in an unmanaged skill skips the entire skill.

Use **Apply to all conflicts** to choose the same action for every file conflict in the current preview. You can then override individual files. The resolved count and **Next unresolved conflict** button help you find any remaining choices in long lists. Confirmation becomes available after every conflict has a choice. These choices reset when you open a new preview.

Confirm the preview to apply changes. Handwritten content outside aicfg's instruction markers is preserved. If relevant configuration or target files change after preview, generate a new preview before applying.

Reapplying a preset clears earlier target version choices. If several presets still require different versions of the same skill, choose a version for this application. The choice is stored for that target without changing shared presets.

## Update skills

Use **Check for updates** in the Library, then choose changed skill versions to adopt. Source commits that do not change the skill's content do not create an update notification.

Adopting an update changes shared configuration. Preview and confirm application separately for each target project. Targets you have not updated retain their recorded installed versions and show **Needs syncing**.

## Explore dependencies

The shared graph shows preset references, including skills and rules used by presets. The local graph also shows target projects connected on this computer. Skills collected only in the Library do not appear until a preset references them.

Click a preset, skill, or target project to focus its dependencies. Unrelated branches fade. Click again, click the background, use **Clear focus**, or press Escape to restore the full view.

## Recover from failures

If saving succeeds but committing fails, configuration remains editable and usable. Use **Retry commit** after fixing the Git issue. A failed push preserves the local commit and pauses automatic pushing; use **Push** when ready.

Use **Sync configuration** for manual Git synchronization. Resolve merge conflicts with your Git tools and then choose **Reload**. Automatic pulling is limited to cases without local changes or unpushed commits.

A caught application failure restores the target's previous managed contents. If recovery also fails, the target becomes **Needs repair** and further application is paused. Repair it with other tools, then resume and generate a fresh preview. Automatic crash or power-loss recovery is outside the current release.

Disconnecting a target removes its local connection while preserving its installed files. See the [configuration reference](configuration.md) for storage details and the [roadmap](roadmap.md) for other limitations.
