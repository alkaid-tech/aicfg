import { describe, expect, it } from "vitest";
import { dependencyGraph, focusDependencyGraph } from "./graph";
import type { State } from "./types";
import { createTranslator } from "./i18n";
const state: State = {
  root: "/config",
  git_status: "Committed locally",
  config: {
    schema_version: 1,
    library: [],
    rules: [],
    presets: [
      {
        id: "parent",
        name: "Parent",
        includes: ["child"],
        skills: [],
        rules: [],
      },
      {
        id: "child",
        name: "Child",
        includes: [],
        skills: [{ skill_id: "missing", revision: "" }],
        rules: [],
      },
    ],
  },
  targets: [
    {
      target: {
        id: "local",
        name: "Consumer",
        path: "/consumer",
        identity: "local",
        repair: false,
        managed: {},
        applied: "",
      },
      config: {
        presets: ["parent", "deleted"],
        excluded: [],
        agents: [],
        versions: {},
      },
      status: "Needs syncing",
      error: null,
    },
  ],
};
describe("dependency graph visibility", () => {
  it("localizes statuses, missing references, and focus descriptions while preserving user names", () => {
    const fixture = structuredClone(state);
    fixture.targets[0].target.name = "My 日本語 project";
    const t = createTranslator("ja");
    const graph = dependencyGraph(fixture, "targets", t);
    const target = graph.nodes.find((node) => node.id === "target:local");
    expect(target?.data.label).toBe("My 日本語 project · 同期が必要");
    expect(target?.ariaLabel).toBe(
      "対象プロジェクト My 日本語 project · 同期が必要",
    );
    expect(
      graph.nodes.find((node) => node.id === "skill:missing")?.data.label,
    ).toBe("この参照先は存在しません。別の項目を選択してください。");
    const focused = focusDependencyGraph(graph, "target:local", t);
    expect(
      focused.nodes.find((node) => node.id === "target:local")?.ariaLabel,
    ).toContain("フォーカス中");
    expect(fixture.targets[0].status).toBe("Needs syncing");
  });
  const withLibrary = (): State => {
    const fixture = structuredClone(state);
    fixture.config.library = ["unused-before", "used", "unused-after"].map(
      (id) => ({
        id,
        name: id,
        source: "https://github.com/example/skills.git",
        skill_path: id,
        revision: "a".repeat(40),
        content_hash: "b".repeat(64),
        description: "",
      }),
    );
    fixture.config.presets[1].skills = [{ skill_id: "used", revision: "" }];
    return fixture;
  };
  it.each(["presets", "targets"] as const)(
    "%s graph only shows skills referenced by a preset, including child presets",
    (mode) => {
      const fixture = withLibrary();
      const graph = dependencyGraph(fixture, mode);
      expect(
        graph.nodes.filter((n) => n.id.startsWith("skill:")).map((n) => n.id),
      ).toEqual(["skill:used"]);
      expect(
        graph.edges.some(
          (e) => e.source === "preset:child" && e.target === "skill:used",
        ),
      ).toBe(true);
      expect(fixture.config.library).toHaveLength(3);
    },
  );
  it.each(["presets", "targets"] as const)(
    "%s graph has no skill nodes when presets do not use any skills",
    (mode) => {
      const fixture = withLibrary();
      fixture.config.presets.forEach((p) => {
        p.skills = [];
      });
      const graph = dependencyGraph(fixture, mode);
      expect(graph.nodes.some((n) => n.id.startsWith("skill:"))).toBe(false);
    },
  );
  it("hidden library skills do not leave blank rows before rules", () => {
    const fixture = withLibrary();
    fixture.config.rules = [{ id: "rule", name: "Rule", paths: [], body: "" }];
    const graph = dependencyGraph(fixture, "presets");
    expect(graph.nodes.find((n) => n.id === "skill:used")?.position.y).toBe(0);
    expect(graph.nodes.find((n) => n.id === "rule:rule")?.position.y).toBe(100);
  });
  it("shared preset graph excludes machine-specific target names", () => {
    const graph = dependencyGraph(state, "presets");
    expect(graph.nodes.some((n) => n.id.startsWith("target:"))).toBe(false);
    expect(
      graph.edges.some(
        (e) => e.source === "preset:parent" && e.target === "preset:child",
      ),
    ).toBe(true);
  });
  it("local graph preserves missing preset references for reselection", () => {
    const graph = dependencyGraph(state, "targets");
    expect(
      graph.edges.some(
        (e) => e.source === "target:local" && e.target === "preset:deleted",
      ),
    ).toBe(true);
    expect(graph.nodes.some((n) => n.id === "preset:deleted")).toBe(true);
  });
  it("all edges point to rendered nodes, including missing skills", () => {
    const graph = dependencyGraph(state, "targets");
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(
      graph.edges.every((e) => ids.has(e.source) && ids.has(e.target)),
    ).toBe(true);
  });
});

describe("dependency graph focus", () => {
  function fixture(mode: "presets" | "targets" = "presets") {
    const value = structuredClone(state);
    value.config.library = [
      "direct",
      "nested",
      "deep",
      "sibling-only",
      "unrelated",
    ].map((id) => ({
      id,
      name: id,
      source: "https://github.com/example/skills.git",
      skill_path: id,
      revision: "a".repeat(40),
      content_hash: "b".repeat(64),
      description: "",
    }));
    value.config.presets = [
      { id: "grand", includes: ["parent"], skills: [] },
      { id: "parent", includes: ["selected", "sibling"], skills: [] },
      { id: "alternate", includes: ["selected"], skills: [] },
      { id: "selected", includes: ["child"], skills: ["direct"] },
      { id: "child", includes: ["leaf"], skills: ["nested"] },
      { id: "leaf", includes: [], skills: ["deep"] },
      { id: "sibling", includes: [], skills: ["nested", "sibling-only"] },
      { id: "unrelated", includes: [], skills: ["unrelated"] },
    ].map((p) => ({
      ...p,
      name: p.id,
      skills: p.skills.map((skill_id) => ({ skill_id, revision: "" })),
      rules: p.id === "selected" ? ["rule"] : [],
    }));
    value.config.rules = [{ id: "rule", name: "Rule", paths: [], body: "" }];
    value.targets[0].config.presets = ["grand"];
    value.targets.push({
      ...structuredClone(value.targets[0]),
      target: { ...value.targets[0].target, id: "other", name: "Other" },
      config: {
        ...value.targets[0].config,
        presets: ["selected", "unrelated"],
      },
    });
    return dependencyGraph(value, mode);
  }
  const highlightedNodes = (graph: ReturnType<typeof dependencyGraph>) =>
    graph.nodes
      .filter((n) => n.style?.opacity === 1)
      .map((n) => n.id)
      .sort();
  const highlightedEdges = (graph: ReturnType<typeof dependencyGraph>) =>
    graph.edges
      .filter((e) => e.style?.opacity === 1)
      .map((e) => `${e.source} -> ${e.target}`)
      .sort();

  it.each(["presets", "targets"] as const)(
    "%s mode focuses a preset's transitive skills and ancestors without spreading into other branches",
    (mode) => {
      const graph = focusDependencyGraph(fixture(mode), "preset:selected");
      expect(highlightedNodes(graph)).toEqual(
        [
          "preset:alternate",
          "preset:child",
          "preset:grand",
          "preset:leaf",
          "preset:parent",
          "preset:selected",
          "skill:deep",
          "skill:direct",
          "skill:nested",
          ...(mode === "targets" ? ["target:local", "target:other"] : []),
        ].sort(),
      );
      expect(highlightedEdges(graph)).toEqual(
        [
          "preset:alternate -> preset:selected",
          "preset:grand -> preset:parent",
          "preset:parent -> preset:selected",
          "preset:selected -> preset:child",
          "preset:selected -> skill:direct",
          "preset:child -> preset:leaf",
          "preset:child -> skill:nested",
          "preset:leaf -> skill:deep",
          ...(mode === "targets"
            ? [
                "target:local -> preset:grand",
                "target:other -> preset:selected",
              ]
            : []),
        ].sort(),
      );
      expect(graph.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual([
        "preset:selected",
      ]);
    },
  );
  it.each(["presets", "targets"] as const)(
    "%s mode focuses every preset and target referencing a skill and the full incoming paths",
    (mode) => {
      const graph = focusDependencyGraph(fixture(mode), "skill:nested");
      expect(highlightedNodes(graph)).toEqual(
        [
          "preset:alternate",
          "preset:child",
          "preset:grand",
          "preset:parent",
          "preset:selected",
          "preset:sibling",
          "skill:nested",
          ...(mode === "targets" ? ["target:local", "target:other"] : []),
        ].sort(),
      );
      expect(highlightedEdges(graph)).toEqual(
        [
          "preset:alternate -> preset:selected",
          "preset:child -> skill:nested",
          "preset:grand -> preset:parent",
          "preset:parent -> preset:selected",
          "preset:parent -> preset:sibling",
          "preset:selected -> preset:child",
          "preset:sibling -> skill:nested",
          ...(mode === "targets"
            ? [
                "target:local -> preset:grand",
                "target:other -> preset:selected",
              ]
            : []),
        ].sort(),
      );
      expect(
        graph.nodes.find((n) => n.id === "skill:sibling-only")?.style?.opacity,
      ).toBeLessThan(1);
    },
  );
  it("focusing a target includes all transitive presets and skills without spreading into other targets sharing its dependencies", () => {
    const original = fixture("targets");
    const target = original.nodes.find((n) => n.id === "target:local");
    expect(target?.focusable).toBe(true);
    expect(target?.ariaRole).toBe("button");
    const graph = focusDependencyGraph(original, "target:local");
    expect(highlightedNodes(graph)).toEqual(
      [
        "target:local",
        "preset:grand",
        "preset:parent",
        "preset:selected",
        "preset:child",
        "preset:leaf",
        "preset:sibling",
        "skill:direct",
        "skill:nested",
        "skill:deep",
        "skill:sibling-only",
      ].sort(),
    );
    expect(highlightedEdges(graph)).toEqual(
      [
        "target:local -> preset:grand",
        "preset:grand -> preset:parent",
        "preset:parent -> preset:selected",
        "preset:parent -> preset:sibling",
        "preset:selected -> preset:child",
        "preset:selected -> skill:direct",
        "preset:child -> preset:leaf",
        "preset:child -> skill:nested",
        "preset:leaf -> skill:deep",
        "preset:sibling -> skill:nested",
        "preset:sibling -> skill:sibling-only",
      ].sort(),
    );
    expect(graph.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual([
      "target:local",
    ]);
    expect(original.nodes.every((n) => !n.selected)).toBe(true);
  });
  it("a target with no presets can focus itself and leave every other node muted", () => {
    const value = structuredClone(state);
    value.targets[0].config.presets = [];
    const graph = focusDependencyGraph(
      dependencyGraph(value, "targets"),
      "target:local",
    );
    expect(highlightedNodes(graph)).toEqual(["target:local"]);
    expect(highlightedEdges(graph)).toEqual([]);
  });
  it("finds a deeply nested skill without highlighting unrelated siblings or other skills", () => {
    const graph = focusDependencyGraph(fixture(), "skill:deep");
    expect(highlightedNodes(graph)).toEqual(
      [
        "preset:alternate",
        "preset:child",
        "preset:grand",
        "preset:leaf",
        "preset:parent",
        "preset:selected",
        "skill:deep",
      ].sort(),
    );
  });
  it("missing reference nodes can still focus the presets that depend on them", () => {
    const graph = focusDependencyGraph(
      dependencyGraph(state, "presets"),
      "skill:missing",
    );
    expect(highlightedNodes(graph)).toEqual([
      "preset:child",
      "preset:parent",
      "skill:missing",
    ]);
  });
  it("clearing or replacing focus restores the original graph without mutating its layout, data or styles", () => {
    const original = fixture();
    const before = structuredClone(original);
    const first = focusDependencyGraph(original, "preset:selected");
    const second = focusDependencyGraph(original, "skill:deep");
    expect(first.nodes.map((n) => n.position)).toEqual(
      original.nodes.map((n) => n.position),
    );
    expect(
      second.nodes.find((n) => n.id === "skill:direct")?.style?.opacity,
    ).toBeLessThan(1);
    expect(focusDependencyGraph(original, "")).toBe(original);
    expect(focusDependencyGraph(original, "preset:deleted")).toBe(original);
    expect(focusDependencyGraph(original, "rule:rule")).toBe(original);
    expect(original).toEqual(before);
  });
  it("terminates even if a malformed graph contains a preset cycle", () => {
    const graph = dependencyGraph(state, "presets");
    graph.edges.push({
      id: "cycle",
      source: "preset:child",
      target: "preset:parent",
    });
    expect(
      highlightedNodes(focusDependencyGraph(graph, "preset:parent")),
    ).toEqual(["preset:child", "preset:parent", "skill:missing"]);
  });
});
