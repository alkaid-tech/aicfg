import type { Node, Edge } from "@xyflow/react";
import type { State } from "./types";
import { createTranslator, translateBackendMessage } from "./i18n";
import type { Message, Translator } from "./i18n";

const nodeKinds: Record<string, Message> = {
  target: "Target project",
  preset: "Preset",
  skill: "Skill",
  rule: "Rule",
};

type DependencyGraph = { nodes: Node[]; edges: Edge[] };

export function canFocusNode(id: string): boolean {
  return (
    id.startsWith("target:") ||
    id.startsWith("preset:") ||
    id.startsWith("skill:")
  );
}

export function focusDependencyGraph(
  graph: DependencyGraph,
  focusedId: string,
  t: Translator = createTranslator("en"),
): DependencyGraph {
  if (!canFocusNode(focusedId) || !graph.nodes.some((n) => n.id === focusedId))
    return graph;

  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    if (!canFocusNode(edge.source) || !canFocusNode(edge.target)) continue;
    const parents = incoming.get(edge.target) ?? [];
    parents.push(edge);
    incoming.set(edge.target, parents);
    const children = outgoing.get(edge.source) ?? [];
    children.push(edge);
    outgoing.set(edge.source, children);
  }

  const relatedNodes = new Set([focusedId]);
  const relatedEdges = new Set<string>();
  function walk(links: Map<string, Edge[]>, direction: "source" | "target") {
    const visited = new Set([focusedId]);
    const pending = [focusedId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const edge of links.get(current) ?? []) {
        relatedEdges.add(edge.id);
        const next = edge[direction];
        relatedNodes.add(next);
        if (!visited.has(next)) {
          visited.add(next);
          pending.push(next);
        }
      }
    }
  }
  // Walk the two directions independently: ancestors' other skills and presets
  // must not enter the focus just because they share an ancestor or a skill.
  walk(incoming, "source");
  if (focusedId.startsWith("preset:") || focusedId.startsWith("target:"))
    walk(outgoing, "target");

  return {
    nodes: graph.nodes.map((node) => {
      const related = relatedNodes.has(node.id);
      const selected = node.id === focusedId;
      return {
        ...node,
        selected,
        className: selected
          ? "graph-node-focused"
          : related
            ? "graph-node-related"
            : "graph-node-muted",
        ariaLabel: `${node.ariaLabel ?? node.data.label}, ${t(selected ? "focused" : related ? "related dependency" : "unrelated")}`,
        style: {
          ...node.style,
          opacity: related ? 1 : 0.22,
          border: selected
            ? "2px solid var(--color-ink)"
            : related
              ? "1px solid var(--color-ink)"
              : node.style?.border,
          background: selected ? "var(--color-signal)" : node.style?.background,
          fontWeight: selected ? 600 : node.style?.fontWeight,
        },
      };
    }),
    edges: graph.edges.map((edge) => ({
      ...edge,
      zIndex: relatedEdges.has(edge.id) ? 1 : 0,
      style: {
        ...edge.style,
        opacity: relatedEdges.has(edge.id) ? 1 : 0.12,
        stroke: relatedEdges.has(edge.id)
          ? "var(--color-ink)"
          : edge.style?.stroke,
        strokeWidth: relatedEdges.has(edge.id) ? 2 : 1,
      },
    })),
  };
}

export function dependencyGraph(
  state: State,
  mode: "presets" | "targets",
  t: Translator = createTranslator("en"),
): DependencyGraph {
  const nodes: Node[] = [],
    edges: Edge[] = [];
  const add = (
    id: string,
    label: string,
    col: number,
    row: number,
    tone: string,
  ) =>
    nodes.push({
      id,
      position: { x: col * 290, y: row * 100 },
      data: { label },
      selected: false,
      focusable: canFocusNode(id),
      ariaRole: canFocusNode(id) ? "button" : "group",
      ariaLabel: `${t(nodeKinds[id.split(":")[0]])} ${label}`,
      deletable: false,
      style: {
        borderRadius: "var(--radius)",
        border: "1px solid var(--color-ink)",
        background: tone,
        color: "var(--color-ink)",
        width: 215,
        padding: 18,
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
      },
      sourcePosition: "right" as Node["sourcePosition"],
      targetPosition: "left" as Node["targetPosition"],
    });
  const link = (source: string, target: string) =>
    edges.push({
      id: `${source}:${target}`,
      source,
      target,
      type: "smoothstep",
      selectable: false,
      deletable: false,
      style: { stroke: "var(--color-muted)" },
    });
  if (mode === "targets") {
    state.targets.forEach((view, i) => {
      const id = `target:${view.target.id}`;
      add(
        id,
        `${view.target.name} · ${translateBackendMessage(t, view.status)}`,
        0,
        i,
        view.status === "Synced"
          ? "var(--color-success-soft)"
          : "var(--color-signal-soft)",
      );
      view.config.presets.forEach((p) => link(id, `preset:${p}`));
    });
  }
  state.config.presets.forEach((preset, i) => {
    add(
      `preset:${preset.id}`,
      preset.name,
      mode === "targets" ? 1 : 0,
      i,
      "var(--color-signal-soft)",
    );
    preset.includes.forEach((p) => link(`preset:${preset.id}`, `preset:${p}`));
    preset.skills.forEach((s) =>
      link(`preset:${preset.id}`, `skill:${s.skill_id}`),
    );
    preset.rules.forEach((r) => link(`preset:${preset.id}`, `rule:${r}`));
  });
  const referencedSkills = new Set(
    state.config.presets.flatMap((preset) =>
      preset.skills.map((reference) => reference.skill_id),
    ),
  );
  const visibleSkills = state.config.library.filter((skill) =>
    referencedSkills.has(skill.id),
  );
  visibleSkills.forEach((skill, i) =>
    add(
      `skill:${skill.id}`,
      skill.name,
      mode === "targets" ? 2 : 1,
      i,
      "var(--color-surface-raised)",
    ),
  );
  state.config.rules.forEach((rule, i) =>
    add(
      `rule:${rule.id}`,
      rule.name,
      mode === "targets" ? 2 : 1,
      visibleSkills.length + i,
      "var(--color-orange-soft)",
    ),
  );
  // Missing references remain visible instead of silently removing affected edges.
  const ids = new Set(nodes.map((n) => n.id));
  [...new Set(edges.map((e) => e.target))]
    .filter((id) => !ids.has(id))
    .forEach((id, i) =>
      add(
        id,
        t("This reference no longer exists. Choose another item."),
        1,
        state.config.presets.length + i,
        "var(--color-danger-soft)",
      ),
    );
  return { nodes, edges };
}
