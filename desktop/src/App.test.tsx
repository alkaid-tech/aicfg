// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { Response, State } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const fixture: State = {
  root: "/test/config",
  git_status: "Clean",
  config: {
    schema_version: 1,
    library: [
      {
        id: "skill-review",
        name: "Code review",
        source: "/test/source",
        skill_path: "review",
        revision: "a".repeat(40),
        content_hash: "b".repeat(64),
        description: "Review code",
      },
      {
        id: "skill-other-review",
        name: "Code review",
        source: "/test/other-source",
        skill_path: "review",
        revision: "c".repeat(40),
        content_hash: "d".repeat(64),
        description: "Review other code",
      },
    ],
    presets: [
      {
        id: "preset-team",
        name: "Team preset",
        skills: [
          { skill_id: "skill-review", revision: "pinned-version" },
          { skill_id: "skill-other-review", revision: "" },
        ],
        rules: [],
        includes: [],
      },
    ],
    rules: [{ id: "rule-style", name: "Style guide", paths: [], body: "Rule" }],
  },
  targets: [
    {
      target: {
        id: "target-project",
        name: "Example project",
        path: "/test/project",
        identity: "example",
        repair: false,
        managed: {},
        applied: "",
      },
      config: { presets: [], excluded: [], agents: [], versions: {} },
      status: "Synced",
      error: null,
    },
  ],
};

function response(state = fixture): Response {
  return {
    state: structuredClone(state),
    notice: null,
    candidates: null,
    preview: null,
    markdown: null,
    updates: null,
  };
}

let container: HTMLDivElement;
let root: Root;

function button(
  label: string,
  scope: ParentNode = container,
): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function click(label: string, scope: ParentNode = container) {
  await act(async () => {
    const element = button(label, scope);
    element.focus();
    element.click();
  });
}

function dialog(): HTMLDialogElement {
  const element = container.querySelector("dialog");
  if (!element) throw new Error("Confirmation dialog not found");
  return element;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(response());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
  vi.mocked(invoke).mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const deletions = [
  {
    name: "Library skill",
    page: null,
    select: null,
    trigger: "Delete Code review",
    title: "Delete skill?",
    itemName: "Code review",
    confirm: "Delete",
    request: { action: "delete", data: { kind: "skill", id: "skill-review" } },
  },
  {
    name: "preset",
    page: "Presets",
    select: null,
    trigger: "Delete Team preset",
    title: "Delete preset?",
    itemName: "Team preset",
    confirm: "Delete",
    request: { action: "delete", data: { kind: "preset", id: "preset-team" } },
  },
  {
    name: "rule",
    page: "Rules",
    select: null,
    trigger: "Delete Style guide",
    title: "Delete rule?",
    itemName: "Style guide",
    confirm: "Delete",
    request: { action: "delete", data: { kind: "rule", id: "rule-style" } },
  },
  {
    name: "target project",
    page: "Target projects",
    select: "Example projectSynced/test/project",
    trigger: "Disconnect target project",
    title: "Disconnect target project?",
    itemName: "Example project",
    confirm: "Disconnect",
    request: { action: "remove_target", data: { id: "target-project" } },
  },
];

describe.each(deletions)("$name confirmation", (entry) => {
  beforeEach(async () => {
    if (entry.page) await click(entry.page);
    if (entry.select) await click(entry.select);
  });

  it("defers the request until confirmation and cancels without deleting", async () => {
    await click(entry.trigger);
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector("h2")?.textContent).toBe(entry.title);
    expect(dialog().querySelector("p")?.textContent).toContain(entry.itemName);
    expect(dialog().getAttribute("aria-describedby")).toBe(
      "delete-description",
    );
    expect(document.activeElement).toBe(button("Cancel", dialog()));
    expect(invoke).not.toHaveBeenCalled();

    await click("Cancel", dialog());
    expect(container.querySelector("dialog")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(button(entry.trigger).disabled).toBe(false);
    expect(document.activeElement).toBe(button(entry.trigger));

    await click(entry.trigger);
    await click(entry.confirm, dialog());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("dispatch", {
      request: entry.request,
    });
    expect(container.querySelector("dialog")).toBeNull();
  });

  it.each(["Close", "Escape"])(
    "cancels with %s without deleting",
    async (method) => {
      await click(entry.trigger);
      if (method === "Close") await click("Close", dialog());
      else
        await act(async () => {
          dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
        });
      expect(container.querySelector("dialog")).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button(entry.trigger));
    },
  );
});

describe("Preset skill removal confirmation", () => {
  beforeEach(async () => {
    await click("Presets");
    await click("View details");
  });

  it("keeps the draft on cancel and removes only the confirmed skill identity before saving", async () => {
    await click("Remove Code review");
    expect(dialog().querySelector("h2")?.textContent).toBe(
      "Remove skill from preset?",
    );
    expect(dialog().querySelector("p")?.textContent).toContain("Team preset");
    expect(container.querySelectorAll(".preset-skill")).toHaveLength(2);
    expect(button("Save changes").disabled).toBe(true);
    await click("Cancel", dialog());
    expect(container.querySelectorAll(".preset-skill")).toHaveLength(2);
    expect(button("Save changes").disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();

    await click("Remove Code review");
    await click("Remove skill", dialog());
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelectorAll(".preset-skill")).toHaveLength(1);
    expect(button("Save changes").disabled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    await click("Save changes");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("dispatch", {
      request: {
        action: "save",
        data: {
          config: {
            ...fixture.config,
            presets: [
              {
                ...fixture.config.presets[0],
                skills: [{ skill_id: "skill-other-review", revision: "" }],
              },
            ],
          },
        },
      },
    });
  });
});

describe("Deletion request state", () => {
  it("prevents repeat confirmation and dismissal while deletion is in progress", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await click("Delete Code review");
    await click("Delete", dialog());
    expect(button("Delete", dialog()).disabled).toBe(true);
    expect(button("Cancel", dialog()).disabled).toBe(true);
    expect(button("Close", dialog()).disabled).toBe(true);
    await click("Delete", dialog());
    await act(async () => {
      dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => finish(response()));
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("keeps failed deletions open and shows the error in the confirmation", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Skill is referenced by a preset");
    await click("Delete Code review");
    await click("Delete", dialog());
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
      "Skill is referenced by a preset",
    );
    expect(button("Cancel", dialog()).disabled).toBe(false);
    expect(button("Delete Code review").disabled).toBe(false);
    await click("Cancel", dialog());
    expect(container.querySelector("dialog")).toBeNull();
  });
});
