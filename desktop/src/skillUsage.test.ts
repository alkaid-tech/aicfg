import { describe, expect, it } from "vitest";
import { getSkillUsage } from "./skillUsage";
import type { State } from "./types";

function fixture(): State {
  const preset = (id: string, includes: string[] = [], direct = false) => ({
    id,
    name: id,
    includes,
    rules: [],
    skills: direct ? [{ skill_id: "review", revision: "" }] : [],
  });
  const target = (id: string, presets: string[], excluded: string[] = []) => ({
    target: {
      id,
      name: id,
      path: "/" + id,
      identity: id,
      repair: false,
      managed: {},
      applied: "",
    },
    config: { presets, excluded, agents: ["claude", "cursor"], versions: {} },
    status: "Needs syncing",
    error: null,
  });
  return {
    root: "/config",
    git_status: "Clean",
    config: {
      schema_version: 1,
      library: [],
      rules: [],
      presets: [
        preset("parent", ["child"]),
        preset("child", [], true),
        preset("unrelated"),
      ],
    },
    targets: [
      target("inherited", ["parent"]),
      target("direct", ["child", "parent"]),
      target("excluded", ["parent"], ["review"]),
      target("unrelated", ["unrelated"]),
    ],
  };
}

describe("Configured skill usage", () => {
  it("includes inherited presets, deduplicates projects and adapters, and respects exclusions", () => {
    const state = fixture();
    const original = structuredClone(state);
    const usage = getSkillUsage(state, "review");
    expect(usage.presets.map((p) => p.id)).toEqual(["parent", "child"]);
    expect(usage.targets.map((t) => t.target.id)).toEqual([
      "inherited",
      "direct",
    ]);
    expect(usage.agents).toEqual(["claude", "cursor"]);
    expect(state).toEqual(original);
  });

  it("handles cyclic and missing references without counting unrelated presets", () => {
    const state = fixture();
    state.config.presets[1].includes = ["parent", "missing"];
    expect(getSkillUsage(state, "review").presets.map((p) => p.id)).toEqual([
      "parent",
      "child",
    ]);
    expect(getSkillUsage(state, "unused")).toEqual({
      presets: [],
      targets: [],
      agents: [],
    });
  });
});
