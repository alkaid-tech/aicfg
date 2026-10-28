import type { State } from "./types";

/** Resolve configured usage, including inherited presets and target exclusions. */
export function getSkillUsage(state: State, skillId: string) {
  const used = new Set(
    state.config.presets
      .filter((preset) => preset.skills.some((ref) => ref.skill_id === skillId))
      .map((preset) => preset.id),
  );
  const parents = new Map<string, string[]>();
  for (const preset of state.config.presets) {
    for (const included of preset.includes) {
      const ids = parents.get(included) ?? [];
      ids.push(preset.id);
      parents.set(included, ids);
    }
  }
  const pending = [...used];
  while (pending.length) {
    for (const id of parents.get(pending.pop()!) ?? []) {
      if (used.has(id)) continue;
      used.add(id);
      pending.push(id);
    }
  }
  const presets = state.config.presets.filter((preset) => used.has(preset.id));
  const targets = state.targets.filter(
    (view) =>
      !view.config.excluded.includes(skillId) &&
      view.config.presets.some((id) => used.has(id)),
  );
  const agents = [...new Set(targets.flatMap((view) => view.config.agents))];
  return { presets, targets, agents };
}
