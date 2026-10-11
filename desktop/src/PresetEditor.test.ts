import { describe, expect, it } from "vitest";
import { availableSkills } from "./PresetEditor";
import type { Skill } from "./types";

const library: Skill[] = [
  {
    id: "review-matt",
    name: "code-review",
    source: "https://github.com/mattpocock/skills.git",
    skill_path: "skills/engineering/code-review",
    description: "Review a branch or PR against coding standards.",
    revision: "a".repeat(40),
    content_hash: "b".repeat(64),
  },
  {
    id: "review-team",
    name: "code-review",
    source: "https://github.com/team/skills.git",
    skill_path: "skills/review",
    description: "Team code review",
    revision: "c".repeat(40),
    content_hash: "d".repeat(64),
  },
];

describe("Preset skill search", () => {
  it("searches across name, description, source and path with case and whitespace normalization", () => {
    expect(
      availableSkills(library, [], "  MATTPOCOCK   standards engineering  "),
    ).toEqual([library[0]]);
    expect(availableSkills(library, [], "team code review")).toEqual([
      library[1],
    ]);
    expect(availableSkills(library, [], "code-review")).toHaveLength(2);
  });
  it("excludes an added skill by stable identity while keeping same-named skills from other sources", () => {
    const selected = [{ skill_id: library[0].id, revision: "pinned-version" }];
    expect(availableSkills(library, selected, "review")).toEqual([library[1]]);
    expect(selected[0].revision).toBe("pinned-version");
  });
  it("clearing search returns the remaining library skills in their original order", () => {
    expect(availableSkills(library, [], "  ")).toEqual(library);
    expect(
      availableSkills(library, [{ skill_id: library[1].id, revision: "" }], ""),
    ).toEqual([library[0]]);
  });
  it("returns no candidates for an unmatched query or an exhausted library", () => {
    expect(availableSkills(library, [], "no-such-skill")).toEqual([]);
    expect(
      availableSkills(
        library,
        library.map((s) => ({ skill_id: s.id, revision: "" })),
        "",
      ),
    ).toEqual([]);
    expect(availableSkills([], [], "review")).toEqual([]);
  });
});
