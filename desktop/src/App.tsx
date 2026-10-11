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

type Page = "library" | "presets" | "rules" | "targets" | "graph" | "settings";
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
    label: "Configuration repository",
    icon: Settings,
    eyebrow: "Your configuration and version history",
    title: "Configuration repository",
  },
];
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
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    if (compact) ref.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [compact]);
  return (
    <dialog
      ref={ref}
      className={compact ? "modal modal-compact" : "modal"}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close"
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
        <p className="muted">No items available</p>
      )}
    </fieldset>
  );
}

export default function App() {
  const [state, setState] = useState<State>(initial),
    [page, setPage] = useState<Page>("library");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [selectedSkill, setSelectedSkill] = useState(""),
    [markdown, setMarkdown] = useState("");
  const [modal, setModal] = useState(""),
    [source, setSource] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [favorites, setFavorites] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>(newPreset),
    [rule, setRule] = useState<Rule>(newRule);
  const [selectedPreset, setSelectedPreset] = useState(""),
    [presetName, setPresetName] = useState("");
  const [pendingPage, setPendingPage] = useState<Page | null>(null);
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
    () => dependencyGraph(state, graphMode),
    [state, graphMode],
  );
  const focusedGraph = useMemo(
    () => focusDependencyGraph(graph, graphFocus),
    [graph, graphFocus],
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
          ? "Choose an empty directory for your configuration repository"
          : "Choose the configuration repository root",
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
        title: "Choose the target project repository root",
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
  async function remove(kind: string, id: string, name: string) {
    if (
      !window.confirm(`Delete “${name}”? Existing references will be checked.`)
    )
      return;
    await run({ action: "delete", data: { kind, id } });
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
        <div className="workspace-label">YOUR AGENT WORKSPACE</div>
        <nav>
          {pages.map((p) => (
            <button
              className={page === p.id ? "nav-item active" : "nav-item"}
              key={p.id}
              disabled={busy}
              onClick={() => navigate(p.id)}
            >
              <p.icon size={18} strokeWidth={1.6} />
              {p.label}
              {p.id === "library" && <span>{state.config.library.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`status-dot ${state.root ? "connected" : ""}`} />
          <div>
            <strong>
              {state.root
                ? "Configuration repository connected"
                : "No configuration repository connected"}
            </strong>
            <small>{state.git_status}</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">
              {presetDetail ? "PRESET / DETAILS AND EDITING" : current.eyebrow}
            </p>
            <h1>{presetDetail ? storedPreset.name : current.title}</h1>
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
                Check for updates
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
                Add skills to Library
              </button>
            )}
            {state.root && page === "presets" && !presetDetail && (
              <button
                className="primary"
                disabled={busy}
                onClick={showCreatePreset}
              >
                <Plus size={16} />
                Create preset
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
                Create rule
              </button>
            )}
            {state.root && page === "targets" && (
              <button className="primary" disabled={busy} onClick={addTarget}>
                <Plus size={16} />
                Add target project
              </button>
            )}
          </div>
        </header>
        {busy && (
          <div className="busy">
            <LoaderCircle size={15} className="spin" />
            Working, please wait…
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}

        {!state.root ? (
          <div className="welcome">
            <div className="welcome-meta">LOCAL FIRST / MACOS</div>
            <h2>
              Organize agent capabilities
              <br />
              for every repository.
            </h2>
            <p>
              Collect skills, compose presets, preview changes.
              <br />
              Keep your configuration in your own Git repository.
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseRepository()}
              >
                <FolderGit2 size={17} />
                Connect configuration repository
                <ArrowUpRight size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => setModal("prepare")}
              >
                Set up a configuration repository
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="welcome-foot">
              <span>01 Collect</span>
              <span>02 Compose</span>
              <span>03 Apply</span>
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
                        aria-label="Search skills"
                        placeholder="Search skills and sources…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <span className="muted">{library.length} skills</span>
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
                            setMarkdown(
                              r?.markdown ??
                                "Could not read the skill content.",
                            );
                          }}
                        >
                          <div className="row-title">
                            <BookOpen size={16} />
                            <strong>{item.name}</strong>
                          </div>
                          <p>{item.description || "Source skill"}</p>
                          <small>
                            {item.source
                              .replace("https://github.com/", "")
                              .replace(".git", "")}
                          </small>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${item.name}`}
                          disabled={busy}
                          onClick={() => remove("skill", item.id, item.name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Add your first skill"
                      text="Choose skills from a source repository."
                    />
                  )}
                </div>
                <div className="detail-panel">
                  {skill ? (
                    <>
                      <div className="detail-heading">
                        <span className="badge">SKILL</span>
                        <h2>{skill.name}</h2>
                        <p className="source-label">{skill.source}</p>
                        <div className="metadata">
                          <span>
                            Adopted version{" "}
                            <code>{skill.revision.slice(0, 8)}</code>
                          </span>
                          <span>
                            Content fingerprint{" "}
                            <code>{skill.content_hash.slice(0, 10)}</code>
                          </span>
                        </div>
                      </div>
                      <Markdown text={markdown} />
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setSource(skill.source);
                          setModal("relocate");
                        }}
                      >
                        Change source location
                      </button>
                    </>
                  ) : (
                    <Empty
                      title="Every skill has a source"
                      text="Select a skill to read its documentation and adopted version."
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
                          {p.skills.length} skills · {p.rules.length} rules ·{" "}
                          {p.includes.length} included presets
                        </p>
                        <div className="tags">
                          {p.includes.map((id) => (
                            <span key={id}>
                              {state.config.presets.find((v) => v.id === id)
                                ?.name ?? "Missing reference"}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => openPreset(p)}
                      >
                        View details
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${p.name}`}
                        disabled={busy}
                        onClick={() => remove("preset", p.id, p.name)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))
                ) : (
                  <Empty
                    title="Combine the skills you use most"
                    text="Presets can contain skills, rules, and references to other presets."
                  >
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={showCreatePreset}
                    >
                      <Plus size={15} />
                      Create your first preset
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
                            : "Entire target project"}
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
                        Edit
                        <ChevronRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${r.name}`}
                        disabled={busy}
                        onClick={() => remove("rule", r.id, r.name)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))
                ) : (
                  <Empty
                    title="Write once, reuse across projects"
                    text="Write rules in Markdown and optionally scope them to files or directories."
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
                            {view.status}
                          </span>
                        </div>
                        <small>{view.target.path}</small>
                      </button>
                    ))
                  ) : (
                    <Empty
                      title="Add your development repository"
                      text="Local project connections are stored separately from shared configuration."
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
                          <p className="error-text">{target.error}</p>
                        )}
                      </div>
                      {!!target.target.installed?.length && (
                        <details>
                          <summary>
                            Skill versions from the last complete application
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
                        label="Selected presets"
                        items={state.config.presets}
                        selected={targetConfig.presets}
                        change={(presets) =>
                          setTargetConfig({ ...targetConfig, presets })
                        }
                      />
                      <Selection
                        label="Enabled agent adapters"
                        items={[
                          { id: "agents", name: "Generic Agents" },
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
                          Excluded skills{" "}
                          <span>{targetConfig.excluded.length}</span>
                        </summary>
                        <Selection
                          label="Exclude from this target project"
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
                          Save configuration
                        </button>
                        <button
                          className="primary"
                          disabled={busy || target.target.repair || targetDirty}
                          onClick={() => showPreview()}
                        >
                          Preview changes
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <p className="hint">
                        {targetDirty
                          ? "Save the configuration to preview file changes."
                          : "Skills and rules are applied after you confirm the changes."}
                      </p>
                      {target.target.repair && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "Have you repaired the target project with another tool? You must preview it again before applying changes.",
                              )
                            )
                              void run({
                                action: "repair",
                                data: { id: selectedTarget },
                              });
                          }}
                        >
                          Resume after manual repair
                        </button>
                      )}
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Disconnect this target project? Installed content will be preserved.",
                            )
                          )
                            void run({
                              action: "remove_target",
                              data: { id: selectedTarget },
                            });
                        }}
                      >
                        Disconnect target project
                      </button>
                    </>
                  ) : (
                    <Empty
                      title="Preview before applying"
                      text="Select a target project to review its presets and installed state."
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
                      Shared preset dependencies
                    </button>
                    <button
                      className={graphMode === "targets" ? "active" : ""}
                      onClick={() => setGraphMode("targets")}
                    >
                      Local target project dependencies
                    </button>
                  </div>
                  <div className="graph-focus-control">
                    <span className="muted" role="status">
                      {focusedGraphNode
                        ? `Focus: ${focusedGraphNode.data.label}`
                        : graphMode === "targets"
                          ? "Click a target project, preset, or skill to focus its dependencies"
                          : "Click a preset or skill to focus its dependencies"}
                    </span>
                    {focusedGraphNode && (
                      <button
                        className="text-button"
                        onClick={() => setGraphFocus("")}
                      >
                        <X size={14} />
                        Clear focus
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
                    title="Explore your dependencies here"
                    text="Create a preset, then add skills, rules, or target project references."
                  />
                )}
              </section>
            )}

            {page === "settings" && (
              <section className="settings-panel">
                <span className="badge green">{state.git_status}</span>
                <h2>You own your configuration.</h2>
                <p className="source-label">{state.root}</p>
                <p>
                  Your Library, presets, and rules live in this Git repository.
                  <br />
                  Local project connections and the latest skill snapshots stay
                  in a Git-ignored directory.
                </p>
                <div className="actions wrap">
                  {[
                    { operation: "sync", label: "Sync configuration" },
                    { operation: "reload", label: "Reload" },
                    { operation: "commit", label: "Retry commit" },
                    { operation: "push", label: "Push" },
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
                  Resolve merge conflicts with your Git tools, then reload the
                  configuration.
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => chooseRepository()}
                >
                  Switch configuration repository
                  <ChevronRight size={16} />
                </button>
              </section>
            )}
          </>
        )}
        <footer className="app-footer">
          <span>Configure · Compose · Apply</span>
          <span>Local first, changes visible</span>
        </footer>
      </main>

      {modal && (
        <Modal
          title={
            (
              {
                source: "Add source skills",
                "create-preset": "Create preset",
                "leave-preset": "Leave this preset?",
                rule: "Edit rule",
                preview: "Preview before applying",
                updates: "Adopt skill updates",
                prepare: "Set up configuration repository",
                relocate: "Change skill source",
              } as Record<string, string>
            )[modal]
          }
          close={close}
          busy={busy}
          compact={modal === "create-preset" || modal === "leave-preset"}
        >
          {modal === "prepare" && (
            <div className="form">
              <label>
                Configuration repository URL
                <input
                  value={prepareUrl}
                  onChange={(e) => setPrepareUrl(e.target.value)}
                  placeholder="GitHub owner/repo; leave blank to create a local Git repository"
                />
              </label>
              <p className="hint">
                Choose an empty directory, or connect an existing configuration
                repository.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseRepository(true)}
              >
                Choose directory and set up repository
              </button>
            </div>
          )}
          {modal === "source" && (
            <div className="form">
              <label>
                Source repository
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="owner/repo, GitHub URL, or local source repository path"
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
                Discover available skills
                <ArrowUpRight size={15} />
              </button>
              <Selection
                label="Choose skills to add to your Library"
                items={candidates.map((c) => c.skill)}
                selected={favorites}
                change={setFavorites}
              />
              {candidates.length > 0 && (
                <details>
                  <summary>Read source skill documentation</summary>
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
                  Add selected skills
                </button>
              </div>
            </div>
          )}
          {modal === "relocate" && skill && (
            <div className="form">
              <label>
                Source repository
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label>
                Skill directory in the source repository
                <input defaultValue={skill.skill_path} id="relocate-path" />
              </label>
              <p className="hint">
                Keep the Library identity and preset references. Check for
                updates and preview changes before applying the new content to
                target projects.
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
                Save source location
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
                You have unsaved changes. Discard them to leave this page. The
                saved preset will remain unchanged.
              </p>
              <div className="actions">
                <button className="secondary" onClick={close}>
                  Keep editing
                </button>
                <button
                  className="primary"
                  onClick={() => completeNavigation(pendingPage)}
                >
                  Discard changes
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
                Rule name
                <input
                  required
                  value={rule.name}
                  onChange={(e) => setRule({ ...rule, name: e.target.value })}
                />
              </label>
              <label>
                Scope
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
                  placeholder="Leave blank for the entire project, or use a glob such as src/**/*.tsx"
                />
              </label>
              <div className="editor-split">
                <label>
                  Markdown content
                  <textarea
                    required
                    rows={14}
                    value={rule.body}
                    onChange={(e) => setRule({ ...rule, body: e.target.value })}
                  />
                </label>
                <div className="editor-preview">
                  <span className="muted">Preview</span>
                  <Markdown text={rule.body} />
                </div>
              </div>
              <div className="actions">
                <button className="primary" disabled={busy} type="submit">
                  Save rule
                </button>
              </div>
            </form>
          )}
          {modal === "updates" && (
            <div className="form">
              <p>
                Adopting source versions updates shared configuration. Preview
                and confirm changes for each target project separately.
              </p>
              <Selection
                label="Skills with content changes"
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
                Adopt selected updates
              </button>
            </div>
          )}
          {modal === "preview" && preview && (
            <div className="form">
              {Object.keys(preview.resolution.conflicts).length > 0 ? (
                <>
                  <p>
                    Reapplying clears previous version choices. Choose a version
                    for each skill below.
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
                          <option value="">Choose a version</option>
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
                    Refresh preview
                  </button>
                </>
              ) : (
                <>
                  <div className="preview-summary">
                    <strong>{preview.changes.length} file changes</strong>
                    <span>
                      {preview.resolution.skills.length} skills ·{" "}
                      {preview.resolution.rules.length} rules
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
                              {c.kind}
                            </span>
                            <span>{c.path}</span>
                          </button>
                        ))}
                      </div>
                      <div className="diff-view">
                        <h3>{preview.changes[changeIndex]?.path}</h3>
                        {preview.changes[changeIndex]?.conflict && (
                          <label className="conflict-choice">
                            Existing content
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
                              <option value="">Choose an option</option>
                              <option value="takeover">
                                Take ownership and keep current content
                              </option>
                              <option value="replace">
                                Replace with preset content
                              </option>
                              <option value="skip">Skip this time</option>
                            </select>
                          </label>
                        )}
                        <div className="diff-columns">
                          <div>
                            <small>Current content</small>
                            <pre>
                              {preview.changes[changeIndex]?.before ||
                                "(not present)"}
                            </pre>
                          </div>
                          <div>
                            <small>Desired content</small>
                            <pre>
                              {preview.changes[changeIndex]?.after ||
                                "(removed)"}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>
                      File contents already match. Confirm to record the
                      application state.
                    </p>
                  )}
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={close}
                    >
                      Cancel and keep current state
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
                      Confirm and apply changes
                      <Check size={15} />
                    </button>
                  </div>
                  <p className="hint">
                    Confirmation reapplies the entire preset. Local edits will
                    be replaced as shown in the preview.
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
