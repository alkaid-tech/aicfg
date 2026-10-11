import { useState } from "react";
import type { FormEvent } from "react";
import { ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import type { Config, Preset, Skill } from "./types";

export function availableSkills(
  library: Skill[],
  selected: Preset["skills"],
  query: string,
): Skill[] {
  const ids = new Set(selected.map((s) => s.skill_id));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return library.filter((skill) => {
    const text =
      `${skill.name} ${skill.description} ${skill.source} ${skill.skill_path}`.toLowerCase();
    return !ids.has(skill.id) && terms.every((term) => text.includes(term));
  });
}

export function CreatePresetForm({
  name,
  busy,
  onNameChange,
  onCreate,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && name.trim()) onCreate();
  }
  return (
    <form className="form preset-create" onSubmit={submit}>
      <p>Name your preset, then add skills and rules on its detail page.</p>
      <label>
        Preset name
        <input
          autoFocus
          required
          value={name}
          disabled={busy}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="For example: Full Stack"
        />
      </label>
      <div className="actions">
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="primary"
          type="submit"
          disabled={busy || !name.trim()}
        >
          Create and open
        </button>
      </div>
    </form>
  );
}

function References({
  label,
  items,
  selected,
  busy,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  busy: boolean;
  onChange: (ids: string[]) => void;
}) {
  const choices = [
    ...items,
    ...selected
      .filter((id) => !items.some((item) => item.id === id))
      .map((id) => ({ id, name: "Missing reference" })),
  ];
  return (
    <details className="preset-options">
      <summary>
        {label}
        <span>{selected.length}</span>
      </summary>
      <fieldset className="selection" disabled={busy}>
        <legend className="sr-only">{label}</legend>
        {choices.length ? (
          choices.map((item) => (
            <label className="check-row" key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
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
    </details>
  );
}

const sourceLabel = (skill: Skill) =>
  `${skill.source.replace("https://github.com/", "").replace(/\.git$/, "")} · ${skill.skill_path}`;

export function PresetDetail({
  preset,
  config,
  busy,
  dirty,
  onChange,
  onRemoveSkill,
  onSave,
  onReset,
  onBack,
}: {
  preset: Preset;
  config: Config;
  busy: boolean;
  dirty: boolean;
  onChange: (preset: Preset) => void;
  onRemoveSkill: (id: string, name: string) => void;
  onSave: () => void;
  onReset: () => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = availableSkills(config.library, preset.skills, query);
  return (
    <section className="preset-detail" aria-label="Preset details">
      <button
        className="text-button preset-back"
        disabled={busy}
        onClick={onBack}
      >
        <ChevronLeft size={15} />
        All presets
      </button>
      <label className="preset-name">
        Name
        <input
          value={preset.name}
          disabled={busy}
          onChange={(event) =>
            onChange({ ...preset, name: event.target.value })
          }
        />
      </label>
      <div className="preset-content">
        <div className="preset-selected">
          <div className="preset-section-heading">
            <h2>Added skills</h2>
            <span>{preset.skills.length}</span>
          </div>
          {preset.skills.length ? (
            <div className="preset-skill-list">
              {preset.skills.map((ref) => {
                const skill = config.library.find((s) => s.id === ref.skill_id);
                const name = skill?.name ?? "Missing reference";
                return (
                  <article className="preset-skill" key={ref.skill_id}>
                    <div className="preset-skill-heading">
                      <div className="grow">
                        <h3>{name}</h3>
                        <small>
                          {skill
                            ? sourceLabel(skill)
                            : "This skill is no longer in the Library"}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Remove ${name}`}
                        onClick={() => onRemoveSkill(ref.skill_id, name)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <details className="preset-version">
                      <summary>
                        {ref.revision
                          ? `Pinned version ${ref.revision.slice(0, 8)}`
                          : "Follow the adopted Library version"}
                      </summary>
                      <label>
                        Source commit
                        <input
                          value={ref.revision}
                          disabled={busy}
                          placeholder="Leave blank to follow the adopted Library version"
                          onChange={(event) =>
                            onChange({
                              ...preset,
                              skills: preset.skills.map((s) =>
                                s.skill_id === ref.skill_id
                                  ? { ...s, revision: event.target.value }
                                  : s,
                              ),
                            })
                          }
                        />
                      </label>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="preset-skill-empty">
              <h3>No skills yet</h3>
              <p>Search the Library on the right to add skills.</p>
            </div>
          )}
        </div>
        <aside
          className="preset-library"
          aria-label="Add skills from the Library"
        >
          <div className="preset-section-heading">
            <h2>Add skills</h2>
            <span>LIBRARY</span>
          </div>
          <label className="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Library skills"
              placeholder="Search by name, description, or source…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear skill search"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <p className="preset-result-count" role="status">
            {matches.length} skills available to add
          </p>
          <div className="preset-search-results">
            {matches.map((skill) => (
              <article className="preset-search-result" key={skill.id}>
                <div className="preset-skill-heading">
                  <h3>{skill.name}</h3>
                  <button
                    className="secondary"
                    disabled={busy}
                    aria-label={`Add ${skill.name}`}
                    onClick={() =>
                      onChange({
                        ...preset,
                        skills: [
                          ...preset.skills,
                          { skill_id: skill.id, revision: "" },
                        ],
                      })
                    }
                  >
                    <Plus size={13} />
                    Add
                  </button>
                </div>
                {skill.description && <p>{skill.description}</p>}
                <small>{sourceLabel(skill)}</small>
              </article>
            ))}
            {!matches.length && (
              <p className="preset-search-empty">
                {!config.library.length
                  ? "Your Library is empty. Add a skill there first."
                  : query.trim()
                    ? "No available skills match. Try another search."
                    : "All Library skills have been added."}
              </p>
            )}
          </div>
        </aside>
      </div>
      <div className="preset-references">
        <References
          label="Rules"
          items={config.rules}
          selected={preset.rules}
          busy={busy}
          onChange={(rules) => onChange({ ...preset, rules })}
        />
        <References
          label="Include other presets"
          items={config.presets.filter((p) => p.id !== preset.id)}
          selected={preset.includes}
          busy={busy}
          onChange={(includes) => onChange({ ...preset, includes })}
        />
      </div>
      <div className="preset-savebar">
        <span role="status">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="header-actions">
          {dirty && (
            <button className="secondary" disabled={busy} onClick={onReset}>
              Discard changes
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !dirty || !preset.name.trim()}
            onClick={onSave}
          >
            Save changes
          </button>
        </div>
      </div>
    </section>
  );
}
