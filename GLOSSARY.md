# Glossary

Use these terms consistently in the interface, documentation, and contributions.

| Term                            | Meaning                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| aicfg                           | This application and its source repository.                                                                                             |
| Library                         | The collection of source skills a user has chosen to reuse. Adding a skill to the Library does not install it into a target project.    |
| Preset                          | A reusable combination of skills, rules, and references to other presets. Use **Preset**, rather than **Template**, for this object.    |
| Target project                  | A development repository that receives skills and rules from aicfg. Use the full term when distinguishing it from aicfg itself.         |
| Configuration repository        | The user's Git repository that stores the shared Library, presets, and rule definitions.                                                |
| Source repository               | An external Git repository containing one or more skills.                                                                               |
| Skill                           | An individual agent capability that can be collected, referenced, and installed independently of other skills in its source repository. |
| Rule                            | Markdown instructions for agent behavior, optionally scoped to particular files or directories.                                         |
| Skill snapshot                  | A local copy of adopted skill content used when installing or restoring that version.                                                   |
| Skill version                   | Skill content identified by its source commit and content fingerprint.                                                                  |
| Skill version override          | A target project's version choice for a skill. This is separate from replacing file contents.                                           |
| Content fingerprint             | A SHA-256 hash of skill content, used to distinguish content changes from unrelated source commits.                                     |
| Display alias                   | A display or search name that does not change a skill's identity or installation name. Planned for a later release.                     |
| Installation name               | The name used for an installed skill, including a preset prefix and stable suffix when needed to disambiguate different sources.        |
| Preset dependency graph         | Shared references between presets and the skills or rules they include.                                                                 |
| Target project dependency graph | Locally connected target projects and their preset references.                                                                          |
| Managed region                  | The section between `aicfg:begin` and `aicfg:end` markers in an instruction file. aicfg preserves content outside it.                   |
| Adapter                         | The logic that generates an agent's directory layout, rule format, and instruction references.                                          |
