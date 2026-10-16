// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import App from "./App";
import { I18nProvider } from "./I18nProvider";
import { createTranslator, LANGUAGE_STORAGE_KEY } from "./i18n";
import type { Preview, Response, State } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_message: string) => {};
  },
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("9.8.7"),
}));
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
  const preferences = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    clear: () => preferences.clear(),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.mocked(getVersion).mockResolvedValue("9.8.7");
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
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Skill detail loading", () => {
  async function selectSkill(index: number) {
    await act(async () => {
      container
        .querySelectorAll<HTMLButtonElement>(".skill-row .row-main")
        [index].click();
    });
  }

  it("keeps loading inside the detail panel and clears the previous skill document", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...response(),
      markdown: "## First skill document",
    });
    await selectSkill(0);
    expect(container.querySelector(".markdown")?.textContent).toContain(
      "First skill document",
    );

    let finish!: (value: Response) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
    await selectSkill(1);
    expect(invoke).toHaveBeenLastCalledWith("dispatch", {
      request: { action: "read_skill", data: { id: "skill-other-review" } },
    });
    expect(
      container.querySelector(".app-shell")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(container.querySelector("main > .busy")).toBeNull();
    expect(button("Presets").disabled).toBe(false);
    expect(
      container.querySelector(".detail-panel")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      container
        .querySelector(".detail-panel [role='status']")
        ?.getAttribute("aria-label"),
    ).toBe("Loading skill…");
    expect(container.querySelector(".markdown")).toBeNull();
    expect(container.querySelector(".detail-heading")?.textContent).toContain(
      "cccccccc",
    );

    await act(async () =>
      finish({ ...response(), markdown: "## Second skill document" }),
    );
    expect(
      container.querySelector(".detail-panel")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(container.querySelector(".skill-loading")).toBeNull();
    expect(container.querySelector(".markdown")?.textContent).toContain(
      "Second skill document",
    );
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an older read that completes with %s after a newer selection",
    async (completion) => {
      const pending: {
        resolve: (value: Response) => void;
        reject: (reason: string) => void;
      }[] = [];
      vi.mocked(invoke).mockImplementation(
        () =>
          new Promise<Response>((resolve, reject) =>
            pending.push({ resolve, reject }),
          ),
      );
      await selectSkill(0);
      await selectSkill(1);
      await act(async () =>
        pending[1].resolve({ ...response(), markdown: "## Latest selection" }),
      );
      await act(async () => {
        if (completion === "resolve")
          pending[0].resolve({
            ...response(),
            markdown: "## Outdated selection",
          });
        else pending[0].reject("An outdated read failed");
      });
      expect(container.querySelector(".markdown")?.textContent).toBe(
        "Latest selection",
      );
      expect(
        container.querySelector(".detail-panel")?.getAttribute("aria-busy"),
      ).toBe("false");
      expect(container.querySelector("[role='alert']")).toBeNull();
    },
  );

  it("shows read failures inside the detail panel and supports retrying", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      "Source content fingerprint does not match",
    );
    await selectSkill(0);
    const error = container.querySelector(".detail-panel [role='alert']");
    expect(error?.textContent).toContain("Could not read the skill content.");
    expect(error?.textContent).toContain(
      "Source content fingerprint does not match",
    );
    expect(container.querySelector("main > .banner.error")).toBeNull();
    expect(container.querySelector(".skill-loading")).toBeNull();

    vi.mocked(invoke).mockResolvedValueOnce({
      ...response(),
      markdown: "## Recovered document",
    });
    await selectSkill(0);
    expect(container.querySelector(".detail-panel [role='alert']")).toBeNull();
    expect(container.querySelector(".markdown")?.textContent).toBe(
      "Recovered document",
    );
  });
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

describe.each([
  {
    locale: "zh" as const,
    titles: ["删除技能？", "删除预设？", "删除规则？", "断开目标项目？"],
    deletion: "从配置中删除“Code review”？删除前将检查现有引用。",
    target: "将“Example project”与 aicfg 断开连接？其仓库和已安装内容将保留。",
    removalTitle: "从预设中移除技能？",
    removal:
      "从“Team preset”中移除“Code review”？该技能将保留在技能库中。保存预设以应用此更改。",
    error: "仍有预设引用此条目，请先移除引用",
  },
  {
    locale: "ja" as const,
    titles: [
      "スキルを削除しますか？",
      "プリセットを削除しますか？",
      "ルールを削除しますか？",
      "対象プロジェクトの接続を解除しますか？",
    ],
    deletion:
      "設定から「Code review」を削除しますか？削除前に既存の参照を確認します。",
    target:
      "「Example project」と aicfg の接続を解除しますか？リポジトリとインストール済みの内容は保持されます。",
    removalTitle: "プリセットからスキルを削除しますか？",
    removal:
      "「Team preset」から「Code review」を削除しますか？スキルはライブラリに残ります。この変更を適用するにはプリセットを保存してください。",
    error: "プリセットがこの項目を参照しています。先に参照を削除してください",
  },
])("Localized deletion confirmations ($locale)", (language) => {
  const t = createTranslator(language.locale);

  beforeEach(async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language.locale);
    await act(async () =>
      root.render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      ),
    );
    vi.mocked(invoke).mockClear();
  });

  it.each(deletions)(
    "translates $name confirmation and preserves the item name",
    async (entry) => {
      if (entry.page === "Presets") await click(t("Presets"));
      if (entry.page === "Rules") await click(t("Rules"));
      if (entry.page === "Target projects") {
        await click(t("Target projects"));
        await click(`Example project${t("Synced")}/test/project`);
      }
      await click(
        entry.page === "Target projects"
          ? t("Disconnect target project")
          : t("Delete {name}", { name: entry.itemName }),
      );
      expect(dialog().querySelector("h2")?.textContent).toBe(
        language.titles[deletions.indexOf(entry)],
      );
      expect(dialog().querySelector("p")?.textContent).toContain(
        entry.itemName,
      );
      if (!entry.page)
        expect(dialog().querySelector("p")?.textContent).toBe(
          language.deletion,
        );
      if (entry.page === "Target projects")
        expect(dialog().querySelector("p")?.textContent).toBe(language.target);
      expect(document.activeElement).toBe(button(t("Cancel"), dialog()));
      expect(invoke).not.toHaveBeenCalled();
      await click(t("Cancel"), dialog());
      expect(container.querySelector("dialog")).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("translates removal without changing skill or preset names", async () => {
    await click(t("Presets"));
    await click(t("View details"));
    await click(t("Remove {name}", { name: "Code review" }));
    expect(dialog().querySelector("h2")?.textContent).toBe(
      language.removalTitle,
    );
    expect(dialog().querySelector("p")?.textContent).toBe(language.removal);
    await click(t("Remove skill"), dialog());
    expect(container.querySelectorAll(".preset-skill")).toHaveLength(1);
    expect(button(t("Save changes")).disabled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("translates a failed deletion inside the confirmation", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      "A preset still references this item. Remove its references first",
    );
    await click(t("Delete {name}", { name: "Code review" }));
    await click(t("Delete"), dialog());
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
      language.error,
    );
    expect(button(t("Cancel"), dialog()).disabled).toBe(false);
  });
});

describe("Target preview feedback", () => {
  const conflictPaths = Array.from(
    { length: 48 },
    (_, index) => `.agents/skills/review/file-${index}.md`,
  );
  const conflictPreview: Preview = {
    token: "conflict-plan",
    changes: [
      {
        path: ".aicfg.toml",
        kind: "Update",
        before: "Old configuration",
        after: "New configuration",
        conflict: false,
      },
      ...conflictPaths.map((path) => ({
        path,
        kind: "Conflict",
        before: "Local content",
        after: "Preset content",
        conflict: true,
      })),
    ],
    resolution: { skills: [], rules: [], conflicts: {} },
  };

  async function openConflictPreview() {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...response(),
      preview: structuredClone(conflictPreview),
    });
    await click("Save and preview changes");
  }

  function conflictSelect(label: string): HTMLSelectElement {
    const element = [...dialog().querySelectorAll("label")]
      .find((element) => element.firstChild?.textContent === label)
      ?.querySelector("select");
    if (!element) throw new Error(`Select not found: ${label}`);
    return element;
  }

  async function chooseConflictOption(label: string, value: string) {
    await act(async () => {
      const element = conflictSelect(label);
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  beforeEach(async () => {
    await click("Target projects");
    await click("Example projectSynced/test/project");
  });

  it.each(["takeover", "replace", "skip"])(
    "resolves a long conflict list with the bulk %s choice and waits for confirmation",
    async (decision) => {
      await openConflictPreview();
      expect(dialog().textContent).toContain("0 of 48 conflicts resolved");
      expect(button("Confirm and apply changes", dialog()).disabled).toBe(true);

      await chooseConflictOption("Apply to all conflicts", decision);
      expect(dialog().textContent).toContain("48 of 48 conflicts resolved");
      expect(button("Confirm and apply changes", dialog()).disabled).toBe(
        false,
      );
      expect(invoke).toHaveBeenCalledTimes(1);

      await click("Confirm and apply changes", dialog());
      expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
        request: {
          action: "apply",
          data: {
            token: "conflict-plan",
            decisions: Object.fromEntries(
              conflictPaths.map((path) => [path, decision]),
            ),
          },
        },
      });
      expect(container.querySelector("dialog")).toBeNull();
    },
  );

  it("finds unresolved conflicts and allows individual overrides after a bulk choice", async () => {
    await openConflictPreview();
    await click("Next unresolved conflict", dialog());
    expect(dialog().querySelector(".diff-view h3")?.textContent).toBe(
      conflictPaths[0],
    );
    await chooseConflictOption("Existing content", "takeover");
    expect(dialog().textContent).toContain("1 of 48 conflicts resolved");
    expect(button("Confirm and apply changes", dialog()).disabled).toBe(true);
    expect(dialog().querySelectorAll(".badge.green")).toHaveLength(1);

    await click("Next unresolved conflict", dialog());
    expect(dialog().querySelector(".diff-view h3")?.textContent).toBe(
      conflictPaths[1],
    );
    await chooseConflictOption("Apply to all conflicts", "replace");
    expect(conflictSelect("Existing content").value).toBe("replace");
    await chooseConflictOption("Existing content", "takeover");
    expect(
      conflictSelect("Apply to all conflicts").selectedOptions[0].text,
    ).toBe("Mixed choices");
    expect(button("Confirm and apply changes", dialog()).disabled).toBe(false);

    await chooseConflictOption("Existing content", "");
    expect(dialog().textContent).toContain("47 of 48 conflicts resolved");
    expect(button("Confirm and apply changes", dialog()).disabled).toBe(true);
    await chooseConflictOption("Existing content", "takeover");
    await click("Confirm and apply changes", dialog());
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      request: {
        action: "apply",
        data: {
          decisions: Object.fromEntries(
            conflictPaths.map((path, index) => [
              path,
              index === 1 ? "takeover" : "replace",
            ]),
          ),
        },
      },
    });
  });

  it("clears bulk choices when opening a new preview", async () => {
    await openConflictPreview();
    await chooseConflictOption("Apply to all conflicts", "replace");
    await click("Cancel and keep current state", dialog());
    await openConflictPreview();
    expect(conflictSelect("Apply to all conflicts").value).toBe("");
    expect(dialog().textContent).toContain("0 of 48 conflicts resolved");
    expect(button("Confirm and apply changes", dialog()).disabled).toBe(true);
  });

  it("explains empty selections and opens an explicit no-change preview", async () => {
    expect(container.textContent).toContain("No presets selected.");
    expect(container.textContent).toContain("temporary directory");
    vi.mocked(invoke).mockResolvedValueOnce({
      ...response(),
      preview: {
        token: "empty-plan",
        changes: [],
        resolution: { skills: [], rules: [], conflicts: {} },
      },
    });
    await click("Save and preview changes");
    expect(dialog().textContent).toContain("No file changes.");
    expect(dialog().textContent).toContain("0 skills · 0 rules");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      request: {
        action: "preview",
        data: { id: "target-project", choices: {} },
      },
    });
  });

  it("saves edited exclusions before previewing and waits for confirmation to apply", async () => {
    await act(async () => {
      container
        .querySelector<HTMLInputElement>(".excluded-skills input")!
        .click();
    });
    expect(button("Save and preview changes").disabled).toBe(false);
    expect(container.textContent).not.toContain("Save configuration");
    const savedState = structuredClone(fixture);
    savedState.targets[0].config.excluded = ["skill-review"];
    let resolveSave!: (value: Response) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve as typeof resolveSave;
        }),
    );
    vi.mocked(invoke).mockResolvedValueOnce({
      ...response(savedState),
      preview: {
        token: "saved-plan",
        changes: [],
        resolution: { skills: [], rules: [], conflicts: {} },
      },
    });
    await click("Save and preview changes");
    expect(button("Save and preview changes").disabled).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      request: {
        action: "save_target",
        data: { id: "target-project", config: savedState.targets[0].config },
      },
    });
    await act(async () => resolveSave(response(savedState)));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      request: { action: "preview" },
    });
    expect(dialog().textContent).toContain("No file changes.");
    await click("Confirm and apply changes", dialog());
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({
      request: {
        action: "apply",
        data: { token: "saved-plan", decisions: {} },
      },
    });
  });

  it("keeps the draft and does not preview when saving fails", async () => {
    await act(async () => {
      container
        .querySelector<HTMLInputElement>(".excluded-skills input")!
        .click();
    });
    vi.mocked(invoke).mockRejectedValueOnce(
      "Could not save target configuration",
    );
    await click("Save and preview changes");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLInputElement>(".excluded-skills input")!
        .checked,
    ).toBe(true);
    expect(container.textContent).toContain(
      "Could not save target configuration",
    );
    expect(button("Save and preview changes").disabled).toBe(false);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("shows live backend activity and keeps failure details visible", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(invoke).mockImplementationOnce((_command, args) => {
      const channel = (args as { onProgress: unknown }).onProgress as {
        onmessage: (message: string) => void;
      };
      channel.onmessage("Installing skill in temporary directory: Code review");
      return new Promise((_resolve, failure) => {
        reject = failure;
      });
    });
    await click("Save and preview changes");
    expect(container.querySelector(".operation-log")?.textContent).toContain(
      "Installing skill in temporary directory: Code review",
    );
    expect(button("Save and preview changes").disabled).toBe(true);
    await act(async () => reject(new Error("Installer unavailable")));
    expect(container.querySelector(".operation-log")?.textContent).toContain(
      "Operation failed.",
    );
    expect(container.textContent).toContain("Installer unavailable");
    expect(button("Save and preview changes").disabled).toBe(false);
  });
});

it("shows the installed application version in the sidebar and settings", async () => {
  expect(container.querySelector(".sidebar-bottom")?.textContent).toContain(
    "v9.8.7",
  );
  await click("Settings");
  expect(container.querySelector(".language-settings")?.textContent).toContain(
    "Application version: 9.8.7",
  );
});
