import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Layers,
  FolderGit2,
  GitBranch,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  RefreshCw,
  X,
  Trash2,
  FileText,
  Check,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import type {
  Candidate,
  Config,
  Preset,
  Preview,
  Request,
  Response,
  Rule,
  Skill,
  State,
  TargetConfig,
} from "./types";
import { canFocusNode, dependencyGraph, focusDependencyGraph } from "./graph";
import { CreatePresetForm, PresetDetail } from "./PresetEditor";
import { useI18n } from "./I18nProvider";
import { translateBackendMessage } from "./i18n";

type Page = "library" | "presets" | "rules" | "targets" | "graph" | "settings";
type Deletion = {
  kind: "skill" | "preset" | "rule" | "target" | "preset-skill";
  id: string;
  name: string;
};
const pages = [
  {
    id: "library" as Page,
    label: "Library",
    icon: BookOpen,
    eyebrow: "Reusable capabilities",
    title: "Skill library",
  },
  {
    id: "presets" as Page,
    label: "Presets",
    icon: Layers,
    eyebrow: "Compose once, apply anywhere",
    title: "Presets",
  },
  {
    id: "rules" as Page,
    label: "Rules",
    icon: FileText,
    eyebrow: "Maintain agent instructions in one place",
    title: "Rules",
  },
  {
    id: "targets" as Page,
    label: "Target projects",
    icon: FolderGit2,
    eyebrow: "From presets to your repositories",
    title: "Target projects",
  },
  {
    id: "graph" as Page,
    label: "Dependencies",
    icon: GitBranch,
    eyebrow: "See how changes affect your projects",
    title: "Dependencies",
  },
  {
    id: "settings" as Page,
    label: "Settings",
    icon: Settings,
    eyebrow: "Your configuration and version history",
    title: "Settings",
  },
] as const;
const initial: State = {
  root: null,
  config: { schema_version: 1, library: [], presets: [], rules: [] },
  targets: [],
  git_status: "Not connected",
};
const newPreset = (): Preset => ({
  id: crypto.randomUUID(),
  name: "",
  skills: [],
  rules: [],
  includes: [],
});
const newRule = (): Rule => ({
  id: crypto.randomUUID(),
  name: "",
  paths: [],
  body: "",
});

function Modal({
  title,
  children,
  close,
  busy,
  compact = false,
  initialFocus,
  descriptionId,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
  compact?: boolean;
  initialFocus?: string;
  descriptionId?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    else if (compact) dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [compact, initialFocus]);
  return (
    <dialog
      ref={ref}
      className={compact ? "modal modal-compact" : "modal"}
      aria-labelledby="modal-title"
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label={t("Close")}
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Layers size={30} strokeWidth={1} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
function Selection({
  label,
  items,
  selected,
  change,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  change: (values: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="selection">
      <legend>{label}</legend>
      {items.length ? (
        items.map((item) => (
          <label key={item.id} className="check-row">
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            <span>{item.name}</span>
          </label>
        ))
      ) : (
        <p className="muted">{t("No items available")}</p>
      )}
    </fieldset>
  );
}

export default function App() {
  const { t, preference, setPreference, persistenceError } = useI18n();
  const [state, setState] = useState<State>(initial),
    [page, setPage] = useState<Page>("library");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [selectedSkill, setSelectedSkill] = useState(""),
    [markdown, setMarkdown] = useState<string | null>("");
  const [modal, setModal] = useState(""),
    [source, setSource] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [favorites, setFavorites] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>(newPreset),
    [rule, setRule] = useState<Rule>(newRule);
  const [selectedPreset, setSelectedPreset] = useState(""),
    [presetName, setPresetName] = useState("");
  const [pendingPage, setPendingPage] = useState<Page | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [selectedTarget, setSelectedTarget] = useState(""),
    [targetConfig, setTargetConfig] = useState<TargetConfig>({
      presets: [],
      excluded: [],
      agents: ["agents", "cursor", "claude"],
      versions: {},
    });
  const [preview, setPreview] = useState<Preview | null>(null),
    [decisions, setDecisions] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [changeIndex, setChangeIndex] = useState(0);
  const [updates, setUpdates] = useState<Skill[]>([]),
    [updateIds, setUpdateIds] = useState<string[]>([]),
    [graphMode, setGraphMode] = useState<"presets" | "targets">("presets");
  const [prepareUrl, setPrepareUrl] = useState("");
  const [graphFocus, setGraphFocus] = useState("");
  const current = pages.find((p) => p.id === page)!;
  const storedPreset = state.config.presets.find(
    (p) => p.id === selectedPreset,
  );
  const presetDetail = page === "presets" && !!storedPreset;
  const presetDirty =
    !!storedPreset && JSON.stringify(preset) !== JSON.stringify(storedPreset);
  const target = state.targets.find((t) => t.target.id === selectedTarget);
  const storedTargetConfig = target ? JSON.stringify(target.config) : "";
  const targetDirty =
    !!target && JSON.stringify(target.config) !== JSON.stringify(targetConfig);
  const skill = state.config.library.find((s) => s.id === selectedSkill);
  const graph = useMemo(
    () => dependencyGraph(state, graphMode, t),
    [state, graphMode, t],
  );
  const focusedGraph = useMemo(
    () => focusDependencyGraph(graph, graphFocus, t),
    [graph, graphFocus, t],
  );
  const focusedGraphNode = graph.nodes.find((node) => node.id === graphFocus);
  const library = state.config.library.filter((s) =>
    `${s.name} ${s.description} ${s.source}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  async function run(request: Request): Promise<Response | undefined> {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<Response>("dispatch", { request });
      setState(result.state);
      if (result.notice) setNotice(result.notice);
      return result;
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) void run({ action: "state" });
    else setNotice("Use the desktop app to connect a local repository.");
  }, []);
  useEffect(() => {
    if (target) setTargetConfig(structuredClone(target.config));
  }, [selectedTarget, storedTargetConfig]);
  useEffect(() => {
    setGraphFocus("");
  }, [graphMode, state.root]);
  useEffect(() => {
    if (graphFocus && !graph.nodes.some((node) => node.id === graphFocus))
      setGraphFocus("");
  }, [graph, graphFocus]);
  async function chooseRepository(prepare = false) {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: prepare
          ? t("Choose an empty directory for your configuration repository")
          : t("Choose the configuration repository root"),
      });
      if (typeof path === "string") {
        const result = await run({
          action: prepare ? "prepare" : "open",
          data: prepare ? { path, url: prepareUrl } : { path },
        });
        if (result) setModal("");
      }
    } catch (e) {
      setError(`Could not select a directory: ${String(e)}`);
    }
  }
  async function addTarget() {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: t("Choose the target project repository root"),
      });
      if (typeof path === "string") {
        const result = await run({ action: "add_target", data: { path } });
        if (result)
          setSelectedTarget(result.state.targets.at(-1)?.target.id ?? "");
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function save(config: Config) {
    return run({ action: "save", data: { config } });
  }
  function navigate(next: Page) {
    if (presetDetail && presetDirty) {
      setPendingPage(next);
      setModal("leave-preset");
      return;
    }
    completeNavigation(next);
  }
  function completeNavigation(next: Page) {
    close();
    setGraphFocus("");
    setSelectedPreset("");
    setPage(next);
    setQuery("");
  }
  function openPreset(value: Preset) {
    setPreset(structuredClone(value));
    setSelectedPreset(value.id);
    setPage("presets");
  }
  function showCreatePreset() {
    setPresetName("");
    setModal("create-preset");
  }
  async function createPreset() {
    if (busy || !presetName.trim()) return;
    const value = { ...newPreset(), name: presetName.trim() };
    const result = await save({
      ...state.config,
      presets: [...state.config.presets, value],
    });
    if (result) {
      close();
      openPreset(
        result.state.config.presets.find((p) => p.id === value.id) ?? value,
      );
    }
  }
  async function savePreset() {
    if (busy || !presetDirty || !preset.name.trim()) return;
    const value = { ...preset, name: preset.name.trim() };
    const result = await save({
      ...state.config,
      presets: state.config.presets.map((p) => (p.id === value.id ? value : p)),
    });
    if (result)
      setPreset(
        structuredClone(
          result.state.config.presets.find((p) => p.id === value.id) ?? value,
        ),
      );
  }
  function remove(kind: Deletion["kind"], id: string, name: string) {
    if (busy) return;
    setError("");
    setDeletion({ kind, id, name });
    setModal("delete");
  }
  async function confirmDeletion() {
    if (busy || !deletion) return;
    const { kind, id } = deletion;
    if (kind === "preset-skill") {
      setPreset((current) => ({
        ...current,
        skills: current.skills.filter((s) => s.skill_id !== id),
      }));
      close();
      return;
    }
    const result = await run(
      kind === "target"
        ? { action: "remove_target", data: { id } }
        : { action: "delete", data: { kind, id } },
    );
    if (result) close();
  }
  async function showPreview(versionChoices: Record<string, string> = {}) {
    const result = await run({
      action: "preview",
      data: { id: selectedTarget, choices: versionChoices },
    });
    if (result?.preview) {
      setPreview(result.preview);
      setDecisions({});
      setChoices(versionChoices);
      setChangeIndex(0);
      setModal("preview");
    }
  }
  const close = () => {
    setModal("");
    setPreview(null);
    setPendingPage(null);
    setDeletion(null);
  };

  return (
    <div className="app-shell" aria-busy={busy}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">a</span>
          <span>
            aicfg<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="workspace-label">{t("YOUR AGENT WORKSPACE")}</div>
        <nav>
          {pages.map((p) => (
            <button
              className={page === p.id ? "nav-item active" : "nav-item"}
              key={p.id}
              disabled={busy}
              onClick={() => navigate(p.id)}
            >
              <p.icon size={18} strokeWidth={1.6} />
              {t(p.label)}
              {p.id === "library" && <span>{state.config.library.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`status-dot ${state.root ? "connected" : ""}`} />
          <div>
            <strong>
              {state.root
                ? t("Configuration repository connected")
                : t("No configuration repository connected")}
            </strong>
            <small>{translateBackendMessage(t, state.git_status)}</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {presetDetail
                ? t("PRESET / DETAILS AND EDITING")
                : t(current.eyebrow)}
            </p>
            <h1>{presetDetail ? storedPreset.name : t(current.title)}</h1>
          </div>
          <div className="header-actions">
            {state.root && (
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  const r = await run({ action: "check_updates" });
                  if (r?.updates?.length) {
                    setUpdates(r.updates);
                    setUpdateIds(r.updates.map((s) => s.id));
                    setModal("updates");
                  }
                }}
              >
                <RefreshCw size={15} />
                {t("Check for updates")}
              </button>
            )}
            {state.root && page === "library" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setCandidates([]);
                  setFavorites([]);
                  setSource("");
                  setModal("source");
                }}
              >
                <Plus size={16} />
                {t("Add skills to Library")}
              </button>
            )}
            {state.root && page === "presets" && !presetDetail && (
              <button
                className="primary"
                disabled={busy}
                onClick={showCreatePreset}
              >
                <Plus size={16} />
                {t("Create preset")}
              </button>
            )}
            {state.root && page === "rules" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setRule(newRule());
                  setModal("rule");
                }}
              >
                <Plus size={16} />
                {t("Create rule")}
              </button>
            )}
            {state.root && page === "targets" && (
              <button className="primary" disabled={busy} onClick={addTarget}>
                <Plus size={16} />
                {t("Add target project")}
              </button>
            )}
          </div>
        </header>
        {busy && (
          <div className="busy">
            <LoaderCircle size={15} className="spin" />
            {t("Working, please wait…")}
          </div>
        )}
        {error && modal !== "delete" && (
          <div className="banner error" role="alert">
            <span>{translateBackendMessage(t, error)}</span>
            <button
              aria-label={t("Dismiss error")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {translateBackendMessage(t, notice)}
          </div>
        )}

        {page === "settings" && (
          <section
            className="language-settings form"
            aria-label={t("Language settings")}
          >
            <label>
              {t("Language")}
              <select
                value={preference}
                onChange={(event) => setPreference(event.target.value)}
              >
                <option value="system">{t("Follow system language")}</option>
                <option value="en">English</option>
                <option value="zh">简体中文</option>
                <option value="ja">日本語</option>
              </select>
            </label>
            <p className="hint">
              {t(
                "Language changes take effect immediately and are saved on this device.",
              )}
            </p>
            {persistenceError && (
              <p className="error-text" role="alert">
                {t(
                  "Language changed for this session, but could not be saved on this device.",
                )}
              </p>
            )}
          </section>
        )}

        {page === "settings" && !state.root && (
          <section className="settings-panel">
            <h2>{t("Configuration repository")}</h2>
            <p>{t("No configuration repository connected")}</p>
            <div className="actions wrap">
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseRepository()}
              >
                <FolderGit2 size={17} />
                {t("Connect configuration repository")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setModal("prepare")}
              >
                {t("Set up a configuration repository")}
              </button>
            </div>
          </section>
        )}

        {!state.root && page !== "settings" ? (
          <div className="welcome">
            <div className="welcome-meta">{t("LOCAL FIRST / MACOS")}</div>
            <h2>
              {t("Organize agent capabilities")}
              <br />
              {t("for every repository.")}
            </h2>
            <p>
              {t("Collect skills, compose presets, preview changes.")}
              <br />
              {t("Keep your configuration in your own Git repository.")}
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseRepository()}
              >
                <FolderGit2 size={17} />
                {t("Connect configuration repository")}
                <ArrowUpRight size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => setModal("prepare")}
              >
                {t("Set up a configuration repository")}
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="welcome-foot">
              <span>{t("01 Collect")}</span>
              <span>{t("02 Compose")}</span>
              <span>{t("03 Apply")}</span>
            </div>
          </div>
        ) : (
          <>
            {page === "library" && (
              <section className="split-panel">
                <div className="list-panel">
                  <div className="list-toolbar">
                    <label className="search">
                      <Search size={15} />
                      <input
                        aria-label={t("Search skills")}
                        placeholder={t("Search skills and sources…")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <span className="muted">
                      {t("{count} skills", { count: library.length })}
                    </span>
                  </div>
                  {library.length ? (
                    library.map((item) => (
                      <div
                        className={`skill-row ${selectedSkill === item.id ? "selected" : ""}`}
                        key={item.id}
                      >
                        <button
                          className="row-main"
                          disabled={busy}
                          onClick={async () => {
                            setSelectedSkill(item.id);
                            const r = await run({
                              action: "read_skill",
                              data: { id: item.id },
                            });
                            setMarkdown(r?.markdown ?? null);
                          }}
                        >
                          <div className="row-title">
                            <BookOpen size={16} />
                            <strong>{item.name}</strong>
                          </div>
                          <p>{item.description || t("Source skill")}</p>
                          <small>
                            {item.source
                              .replace("https://github.com/", "")
                              .replace(".git", "")}
                          </small>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={t("Delete {name}", { name: item.name })}
                          disabled={busy}
                          onClick={() => remove("skill", item.id, item.name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title={t("Add your first skill")}
                      text={t("Choose skills from a source repository.")}
                    />
                  )}
                </div>
                <div className="detail-panel">
                  {skill ? (
                    <>
                      <div className="detail-heading">
                        <span className="badge">{t("SKILL")}</span>
                        <h2>{skill.name}</h2>
                        <p className="source-label">{skill.source}</p>
                        <div className="metadata">
                          <span>
                            {t("Adopted version")}{" "}
                            <code>{skill.revision.slice(0, 8)}</code>
                          </span>
                          <span>
                            {t("Content fingerprint")}{" "}
                            <code>{skill.content_hash.slice(0, 10)}</code>
                          </span>
                        </div>
                      </div>
                      <Markdown
                        text={
                          markdown ?? t("Could not read the skill content.")
                        }
                      />
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setSource(skill.source);
                          setModal("relocate");
                        }}
                      >
                        {t("Change source location")}
                      </button>
                    </>
                  ) : (
                    <Empty
                      title={t("Every skill has a source")}
                      text={t(
                        "Select a skill to read its documentation and adopted version.",
                      )}
                    />
                  )}
                </div>
              </section>
            )}

            {presetDetail && (
              <PresetDetail
                key={selectedPreset}
                preset={preset}
                config={state.config}
                busy={busy}
                dirty={presetDirty}
                onChange={setPreset}
                onRemoveSkill={(id, name) => remove("preset-skill", id, name)}
                onSave={savePreset}
                onReset={() => setPreset(structuredClone(storedPreset!))}
                onBack={() => navigate("presets")}
              />
            )}

            {page === "presets" && !presetDetail && (
              <section className="collection">
                {state.config.presets.length ? (
                  state.config.presets.map((p) => (
                    <article className="preset-row" key={p.id}>
                      <div className="tile-icon">
                        <Layers size={20} />
                      </div>
                      <div className="grow">
                        <h3>{p.name}</h3>
                        <p>
                          {t(
                            "{skills} skills · {rules} rules · {presets} included presets",
                            {
                              skills: p.skills.length,
                              rules: p.rules.length,
                              presets: p.includes.length,
                            },
                          )}
                        </p>
                        <div className="tags">
                          {p.includes.map((id) => (
                            <span key={id}>
                              {state.config.presets.find((v) => v.id === id)
                                ?.name ?? t("Missing reference")}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => openPreset(p)}
                      >
                        {t("View details")}
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t("Delete {name}", { name: p.name })}
                        disabled={busy}
                        onClick={() => remove("preset", p.id, p.name)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))
                ) : (
                  <Empty
                    title={t("Combine the skills you use most")}
                    text={t(
                      "Presets can contain skills, rules, and references to other presets.",
                    )}
                  >
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={showCreatePreset}
                    >
                      <Plus size={15} />
                      {t("Create your first preset")}
                    </button>
                  </Empty>
                )}
              </section>
            )}

            {page === "rules" && (
              <section className="collection">
                {state.config.rules.length ? (
                  state.config.rules.map((r) => (
                    <article className="preset-row" key={r.id}>
                      <div className="tile-icon">
                        <FileText size={20} />
                      </div>
                      <div className="grow">
                        <h3>{r.name}</h3>
                        <p>
                          {r.paths.length
                            ? r.paths.join(" · ")
                            : t("Entire target project")}
                        </p>
                        <small>{r.body.slice(0, 100)}</small>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => {
                          setRule(structuredClone(r));
                          setModal("rule");
                        }}
                      >
                        {t("Edit")}
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t("Delete {name}", { name: r.name })}
                        disabled={busy}
                        onClick={() => remove("rule", r.id, r.name)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))
                ) : (
                  <Empty
                    title={t("Write once, reuse across projects")}
                    text={t(
                      "Write rules in Markdown and optionally scope them to files or directories.",
                    )}
                  />
                )}
              </section>
            )}

            {page === "targets" && (
              <section className="split-panel">
                <div className="list-panel">
                  {state.targets.length ? (
                    state.targets.map((view) => (
                      <button
                        key={view.target.id}
                        className={`target-row ${selectedTarget === view.target.id ? "selected" : ""}`}
                        onClick={() => setSelectedTarget(view.target.id)}
                      >
                        <div className="row-title">
                          <FolderGit2 size={17} />
                          <strong>{view.target.name}</strong>
                          <span
                            className={`badge ${view.status === "Synced" ? "green" : "yellow"}`}
                          >
                            {translateBackendMessage(t, view.status)}
                          </span>
                        </div>
                        <small>{view.target.path}</small>
                      </button>
                    ))
                  ) : (
                    <Empty
                      title={t("Add your development repository")}
                      text={t(
                        "Local project connections are stored separately from shared configuration.",
                      )}
                    />
                  )}
                </div>
                <div className="detail-panel">
                  {target ? (
                    <>
                      <div className="detail-heading">
                        <h2>{target.target.name}</h2>
                        <p className="source-label">{target.target.path}</p>
                        {target.error && (
                          <p className="error-text">
                            {translateBackendMessage(t, target.error)}
                          </p>
                        )}
                      </div>
                      {!!target.target.installed?.length && (
                        <details>
                          <summary>
                            {t(
                              "Skill versions from the last complete application",
                            )}
                          </summary>
                          {target.target.installed.map((item) => (
                            <p className="hint" key={item.skill.id}>
                              {item.install_name} ·{" "}
                              <code>{item.revision.slice(0, 12)}</code>
                            </p>
                          ))}
                        </details>
                      )}
                      <Selection
                        label={t("Selected presets")}
                        items={state.config.presets}
                        selected={targetConfig.presets}
                        change={(presets) =>
                          setTargetConfig({ ...targetConfig, presets })
                        }
                      />
                      <Selection
                        label={t("Enabled agent adapters")}
                        items={[
                          { id: "agents", name: t("Generic Agents") },
                          { id: "claude", name: "Claude" },
                          { id: "cursor", name: "Cursor" },
                        ]}
                        selected={targetConfig.agents}
                        change={(agents) =>
                          setTargetConfig({ ...targetConfig, agents })
                        }
                      />
                      <details>
                        <summary>
                          {t("Excluded skills")}{" "}
                          <span>{targetConfig.excluded.length}</span>
                        </summary>
                        <Selection
                          label={t("Exclude from this target project")}
                          items={state.config.library}
                          selected={targetConfig.excluded}
                          change={(excluded) =>
                            setTargetConfig({ ...targetConfig, excluded })
                          }
                        />
                      </details>
                      <div className="actions">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            run({
                              action: "save_target",
                              data: {
                                id: selectedTarget,
                                config: targetConfig,
                              },
                            })
                          }
                        >
                          {t("Save configuration")}
                        </button>
                        <button
                          className="primary"
                          disabled={busy || target.target.repair || targetDirty}
                          onClick={() => showPreview()}
                        >
                          {t("Preview changes")}
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <p className="hint">
                        {targetDirty
                          ? t("Save the configuration to preview file changes.")
                          : t(
                              "Skills and rules are applied after you confirm the changes.",
                            )}
                      </p>
                      {target.target.repair && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                t(
                                  "Have you repaired the target project with another tool? You must preview it again before applying changes.",
                                ),
                              )
                            )
                              void run({
                                action: "repair",
                                data: { id: selectedTarget },
                              });
                          }}
                        >
                          {t("Resume after manual repair")}
                        </button>
                      )}
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          remove("target", target.target.id, target.target.name)
                        }
                      >
                        {t("Disconnect target project")}
                      </button>
                    </>
                  ) : (
                    <Empty
                      title={t("Preview before applying")}
                      text={t(
                        "Select a target project to review its presets and installed state.",
                      )}
                    />
                  )}
                </div>
              </section>
            )}

            {page === "graph" && (
              <section
                className="graph-panel"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setGraphFocus("");
                  if (event.key !== "Enter" && event.key !== " ") return;
                  const id = (event.target as HTMLElement)
                    .closest(".react-flow__node")
                    ?.getAttribute("data-id");
                  if (id && canFocusNode(id)) {
                    event.preventDefault();
                    setGraphFocus((current) => (current === id ? "" : id));
                  }
                }}
              >
                <div className="graph-toolbar">
                  <div className="segmented">
                    <button
                      className={graphMode === "presets" ? "active" : ""}
                      onClick={() => setGraphMode("presets")}
                    >
                      {t("Shared preset dependencies")}
                    </button>
                    <button
                      className={graphMode === "targets" ? "active" : ""}
                      onClick={() => setGraphMode("targets")}
                    >
                      {t("Local target project dependencies")}
                    </button>
                  </div>
                  <div className="graph-focus-control">
                    <span className="muted" role="status">
                      {focusedGraphNode
                        ? t("Focus: {name}", {
                            name: String(focusedGraphNode.data.label),
                          })
                        : graphMode === "targets"
                          ? t(
                              "Click a target project, preset, or skill to focus its dependencies",
                            )
                          : t(
                              "Click a preset or skill to focus its dependencies",
                            )}
                    </span>
                    {focusedGraphNode && (
                      <button
                        className="text-button"
                        onClick={() => setGraphFocus("")}
                      >
                        <X size={14} />
                        {t("Clear focus")}
                      </button>
                    )}
                  </div>
                </div>
                {graph.nodes.length ? (
                  <ReactFlow
                    key={graphMode + state.config.presets.length}
                    nodes={focusedGraph.nodes}
                    edges={focusedGraph.edges}
                    onNodeClick={(_, node) =>
                      setGraphFocus((current) =>
                        canFocusNode(node.id) && current !== node.id
                          ? node.id
                          : "",
                      )
                    }
                    onPaneClick={() => setGraphFocus("")}
                    edgesFocusable={false}
                    ariaLabelConfig={{
                      "node.a11yDescription.default": t(
                        "Press Enter or Space to focus dependencies. Press Escape to clear focus.",
                      ),
                      "node.a11yDescription.keyboardDisabled": t(
                        "Press Enter or Space to focus dependencies. Press Escape to clear focus.",
                      ),
                      "controls.ariaLabel": t("Dependencies graph"),
                      "controls.zoomIn.ariaLabel": t("Zoom in"),
                      "controls.zoomOut.ariaLabel": t("Zoom out"),
                      "controls.fitView.ariaLabel": t("Fit view"),
                    }}
                    deleteKeyCode={null}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background gap={24} color="#e5e5de" />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                ) : (
                  <Empty
                    title={t("Explore your dependencies here")}
                    text={t(
                      "Create a preset, then add skills, rules, or target project references.",
                    )}
                  />
                )}
              </section>
            )}

            {page === "settings" && state.root && (
              <section className="settings-panel">
                <span className="badge green">
                  {translateBackendMessage(t, state.git_status)}
                </span>
                <h2>{t("You own your configuration.")}</h2>
                <p className="source-label">{state.root}</p>
                <p>
                  {t(
                    "Your Library, presets, and rules live in this Git repository.",
                  )}
                  <br />
                  {t(
                    "Local project connections and the latest skill snapshots stay in a Git-ignored directory.",
                  )}
                </p>
                <div className="actions wrap">
                  {[
                    { operation: "sync", label: t("Sync configuration") },
                    { operation: "reload", label: t("Reload") },
                    { operation: "commit", label: t("Retry commit") },
                    { operation: "push", label: t("Push") },
                  ].map((a) => (
                    <button
                      className="secondary"
                      disabled={busy}
                      key={a.operation}
                      onClick={() =>
                        run({ action: "git", data: { operation: a.operation } })
                      }
                    >
                      <GitBranch size={15} />
                      {a.label}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  {t(
                    "Resolve merge conflicts with your Git tools, then reload the configuration.",
                  )}
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => chooseRepository()}
                >
                  {t("Switch configuration repository")}
                  <ChevronRight size={16} />
                </button>
              </section>
            )}
          </>
        )}
        <footer className="app-footer">
          <span>{t("Configure · Compose · Apply")}</span>
          <span>{t("Local first, changes visible")}</span>
        </footer>
      </main>

      {modal && (
        <Modal
          title={
            (
              {
                source: t("Add source skills"),
                "create-preset": t("Create preset"),
                "leave-preset": t("Leave this preset?"),
                rule: t("Edit rule"),
                preview: t("Preview before applying"),
                updates: t("Adopt skill updates"),
                prepare: t("Set up configuration repository"),
                relocate: t("Change skill source"),
                delete:
                  deletion?.kind === "target"
                    ? t("Disconnect target project?")
                    : deletion?.kind === "preset-skill"
                      ? t("Remove skill from preset?")
                      : deletion?.kind === "skill"
                        ? t("Delete skill?")
                        : deletion?.kind === "preset"
                          ? t("Delete preset?")
                          : t("Delete rule?"),
              } as Record<string, string>
            )[modal]
          }
          close={close}
          busy={busy}
          compact={
            modal === "create-preset" ||
            modal === "leave-preset" ||
            modal === "delete"
          }
          initialFocus={modal === "delete" ? "[data-cancel]" : undefined}
          descriptionId={modal === "delete" ? "delete-description" : undefined}
        >
          {modal === "delete" && deletion && (
            <div className="form confirmation">
              <p id="delete-description">
                {deletion.kind === "target"
                  ? t(
                      "Disconnect “{name}” from aicfg? Its repository and installed content will be preserved.",
                      { name: deletion.name },
                    )
                  : deletion.kind === "preset-skill"
                    ? t(
                        "Remove “{name}” from “{preset}”? The skill will remain in your Library. Save the preset to apply this change.",
                        { name: deletion.name, preset: preset.name },
                      )
                    : t(
                        "Delete “{name}” from your configuration? Existing references will be checked before deletion.",
                        { name: deletion.name },
                      )}
              </p>
              {error && (
                <p className="error-text" role="alert">
                  {translateBackendMessage(t, error)}
                </p>
              )}
              <div className="actions">
                <button
                  className="secondary"
                  data-cancel
                  disabled={busy}
                  onClick={close}
                >
                  {t("Cancel")}
                </button>
                <button
                  className="primary destructive"
                  disabled={busy}
                  onClick={confirmDeletion}
                >
                  {deletion.kind === "target"
                    ? t("Disconnect")
                    : deletion.kind === "preset-skill"
                      ? t("Remove skill")
                      : t("Delete")}
                </button>
              </div>
            </div>
          )}
          {modal === "prepare" && (
            <div className="form">
              <label>
                {t("Configuration repository URL")}
                <input
                  value={prepareUrl}
                  onChange={(e) => setPrepareUrl(e.target.value)}
                  placeholder={t(
                    "GitHub owner/repo; leave blank to create a local Git repository",
                  )}
                />
              </label>
              <p className="hint">
                {t(
                  "Choose an empty directory, or connect an existing configuration repository.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseRepository(true)}
              >
                {t("Choose directory and set up repository")}
              </button>
            </div>
          )}
          {modal === "source" && (
            <div className="form">
              <label>
                {t("Source repository")}
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t(
                    "owner/repo, GitHub URL, or local source repository path",
                  )}
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !source.trim()}
                onClick={async () => {
                  const r = await run({ action: "inspect", data: { source } });
                  setCandidates(r?.candidates ?? []);
                  setFavorites([]);
                }}
              >
                {t("Discover available skills")}
                <ArrowUpRight size={15} />
              </button>
              <Selection
                label={t("Choose skills to add to your Library")}
                items={candidates.map((c) => c.skill)}
                selected={favorites}
                change={setFavorites}
              />
              {candidates.length > 0 && (
                <details>
                  <summary>{t("Read source skill documentation")}</summary>
                  {candidates.map((c) => (
                    <article key={c.skill.id}>
                      <h3>{c.skill.name}</h3>
                      <Markdown text={c.markdown} />
                    </article>
                  ))}
                </details>
              )}
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || favorites.length === 0}
                  onClick={async () => {
                    if (
                      await run({
                        action: "favorite",
                        data: { ids: favorites },
                      })
                    )
                      close();
                  }}
                >
                  <Check size={15} />
                  {t("Add selected skills")}
                </button>
              </div>
            </div>
          )}
          {modal === "relocate" && skill && (
            <div className="form">
              <label>
                {t("Source repository")}
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label>
                {t("Skill directory in the source repository")}
                <input defaultValue={skill.skill_path} id="relocate-path" />
              </label>
              <p className="hint">
                {t(
                  "Keep the Library identity and preset references. Check for updates and preview changes before applying the new content to target projects.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const path = (
                    document.getElementById("relocate-path") as HTMLInputElement
                  ).value;
                  if (
                    await run({
                      action: "relocate_source",
                      data: { id: skill.id, source, skill_path: path },
                    })
                  ) {
                    setMarkdown("");
                    close();
                  }
                }}
              >
                {t("Save source location")}
              </button>
            </div>
          )}
          {modal === "create-preset" && (
            <CreatePresetForm
              name={presetName}
              busy={busy}
              onNameChange={setPresetName}
              onCreate={createPreset}
              onCancel={close}
            />
          )}
          {modal === "leave-preset" && pendingPage && (
            <div className="form preset-create">
              <p>
                {t(
                  "You have unsaved changes. Discard them to leave this page. The saved preset will remain unchanged.",
                )}
              </p>
              <div className="actions">
                <button className="secondary" onClick={close}>
                  {t("Keep editing")}
                </button>
                <button
                  className="primary"
                  onClick={() => completeNavigation(pendingPage)}
                >
                  {t("Discard changes")}
                </button>
              </div>
            </div>
          )}
          {modal === "rule" && (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await save({
                    ...state.config,
                    rules: [
                      ...state.config.rules.filter((r) => r.id !== rule.id),
                      rule,
                    ],
                  })
                )
                  close();
              }}
            >
              <label>
                {t("Rule name")}
                <input
                  required
                  value={rule.name}
                  onChange={(e) => setRule({ ...rule, name: e.target.value })}
                />
              </label>
              <label>
                {t("Scope")}
                <input
                  value={rule.paths.join(", ")}
                  onChange={(e) =>
                    setRule({
                      ...rule,
                      paths: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={t(
                    "Leave blank for the entire project, or use a glob such as src/**/*.tsx",
                  )}
                />
              </label>
              <div className="editor-split">
                <label>
                  {t("Markdown content")}
                  <textarea
                    required
                    rows={14}
                    value={rule.body}
                    onChange={(e) => setRule({ ...rule, body: e.target.value })}
                  />
                </label>
                <div className="editor-preview">
                  <span className="muted">{t("Preview")}</span>
                  <Markdown text={rule.body} />
                </div>
              </div>
              <div className="actions">
                <button className="primary" disabled={busy} type="submit">
                  {t("Save rule")}
                </button>
              </div>
            </form>
          )}
          {modal === "updates" && (
            <div className="form">
              <p>
                {t(
                  "Adopting source versions updates shared configuration. Preview and confirm changes for each target project separately.",
                )}
              </p>
              <Selection
                label={t("Skills with content changes")}
                items={updates}
                selected={updateIds}
                change={setUpdateIds}
              />
              {updates.map((s) => (
                <div className="version-row" key={s.id}>
                  <strong>{s.name}</strong>
                  <code>
                    {state.config.library
                      .find((v) => v.id === s.id)
                      ?.revision.slice(0, 8)}{" "}
                    / {s.revision.slice(0, 8)}
                  </code>
                </div>
              ))}
              <button
                className="primary"
                disabled={busy || !updateIds.length}
                onClick={async () => {
                  if (
                    await run({
                      action: "adopt_updates",
                      data: { ids: updateIds },
                    })
                  )
                    close();
                }}
              >
                {t("Adopt selected updates")}
              </button>
            </div>
          )}
          {modal === "preview" && preview && (
            <div className="form">
              {Object.keys(preview.resolution.conflicts).length > 0 ? (
                <>
                  <p>
                    {t(
                      "Reapplying clears previous version choices. Choose a version for each skill below.",
                    )}
                  </p>
                  {Object.entries(preview.resolution.conflicts).map(
                    ([id, versions]) => (
                      <label key={id}>
                        {state.config.library.find((s) => s.id === id)?.name}
                        <select
                          value={choices[id] ?? ""}
                          onChange={(e) =>
                            setChoices({ ...choices, [id]: e.target.value })
                          }
                        >
                          <option value="">{t("Choose a version")}</option>
                          {versions.map((v) => (
                            <option key={v} value={v}>
                              {v.slice(0, 12)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ),
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      Object.keys(preview.resolution.conflicts).some(
                        (id) => !choices[id],
                      )
                    }
                    onClick={() => showPreview(choices)}
                  >
                    {t("Refresh preview")}
                  </button>
                </>
              ) : (
                <>
                  <div className="preview-summary">
                    <strong>
                      {t("{count} file changes", {
                        count: preview.changes.length,
                      })}
                    </strong>
                    <span>
                      {t("{skills} skills · {rules} rules", {
                        skills: preview.resolution.skills.length,
                        rules: preview.resolution.rules.length,
                      })}
                    </span>
                  </div>
                  {preview.changes.length > 0 ? (
                    <div className="diff-layout">
                      <div className="diff-list">
                        {preview.changes.map((c, i) => (
                          <button
                            key={c.path}
                            className={changeIndex === i ? "selected" : ""}
                            onClick={() => setChangeIndex(i)}
                          >
                            <span
                              className={`badge ${c.conflict ? "yellow" : ""}`}
                            >
                              {translateBackendMessage(t, c.kind)}
                            </span>
                            <span>{c.path}</span>
                          </button>
                        ))}
                      </div>
                      <div className="diff-view">
                        <h3>{preview.changes[changeIndex]?.path}</h3>
                        {preview.changes[changeIndex]?.conflict && (
                          <label className="conflict-choice">
                            {t("Existing content")}
                            <select
                              value={
                                decisions[preview.changes[changeIndex].path] ??
                                ""
                              }
                              onChange={(e) =>
                                setDecisions({
                                  ...decisions,
                                  [preview.changes[changeIndex].path]:
                                    e.target.value,
                                })
                              }
                            >
                              <option value="">{t("Choose an option")}</option>
                              <option value="takeover">
                                {t("Take ownership and keep current content")}
                              </option>
                              <option value="replace">
                                {t("Replace with preset content")}
                              </option>
                              <option value="skip">
                                {t("Skip this time")}
                              </option>
                            </select>
                          </label>
                        )}
                        <div className="diff-columns">
                          <div>
                            <small>{t("Current content")}</small>
                            <pre>
                              {preview.changes[changeIndex]?.before ||
                                t("(not present)")}
                            </pre>
                          </div>
                          <div>
                            <small>{t("Desired content")}</small>
                            <pre>
                              {preview.changes[changeIndex]?.after ||
                                t("(removed)")}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>
                      {t(
                        "File contents already match. Confirm to record the application state.",
                      )}
                    </p>
                  )}
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={close}
                    >
                      {t("Cancel and keep current state")}
                    </button>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        preview.changes.some(
                          (c) => c.conflict && !decisions[c.path],
                        )
                      }
                      onClick={async () => {
                        if (
                          await run({
                            action: "apply",
                            data: { token: preview.token, decisions },
                          })
                        )
                          close();
                      }}
                    >
                      {t("Confirm and apply changes")}
                      <Check size={15} />
                    </button>
                  </div>
                  <p className="hint">
                    {t(
                      "Confirmation reapplies the entire preset. Local edits will be replaced as shown in the preview.",
                    )}
                  </p>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
