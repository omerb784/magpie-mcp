// S7 P4.D–G — template builder form.
// v0.9.3 Phase F3b polish — Tier-numbered panels (Identity → Body → Variables
// → References) + sticky live-render pane + footer action bar per mock
// magpie://visual/f5RytaUpi4xa v8.

import { useEffect, useMemo, useState } from "react";
import type {
  ReferenceItem,
  SendTemplate,
  VarSchema,
  VarSchemaItem,
} from "../send-template-utils";
import { extractVarNames, nextRefSlot, togglePin } from "../send-template-utils";

interface Project {
  id: string;
  name: string;
}

interface Visual {
  id: string;
  title: string;
  project_id: string;
  current_ver?: number;
}

type ScopeKind = "global" | "project" | "visual";

export interface BuilderProps {
  id: string | null;
  templates: SendTemplate[];
  projects: Project[];
  visuals: Visual[];
  onBack: () => void;
  onSaved: (t: SendTemplate) => void;
  onDeleted: () => void;
}

interface FormState {
  name: string;
  body: string;
  scopeKind: ScopeKind;
  scopeProjectId: string;
  scopeVisualId: string;
  varSchema: VarSchemaItem[];
  examples: ReferenceItem[];
}

const MAX_VARS = 5;
const MAX_REFERENCES = 3;
const MARK_SRC = "/logo-A-v4-faithful.png";

// v0.9.3 Phase E / T3 — format-affinity hints for the 3 HTML-specialized
// builtins. Soft signal only; no hard validation.
const FORMAT_AFFINITY: Record<string, string> = {
  "builtin-a11y-audit": "Best on HTML visuals — WCAG criteria assume rendered DOM.",
  "builtin-responsive-check": "Best on HTML visuals — breakpoints assume CSS layout.",
  "builtin-dark-mode-port": "Best on HTML / SVG visuals — color tokens assume CSS.",
};

function blankSchemaItem(): VarSchemaItem {
  return { name: "", type: "string" };
}

function emptyForm(): FormState {
  return {
    name: "",
    body: "",
    scopeKind: "global",
    scopeProjectId: "",
    scopeVisualId: "",
    varSchema: [],
    examples: [],
  };
}

function deriveForm(t: SendTemplate): FormState {
  let scopeKind: ScopeKind = "global";
  if (t.scope_visual_id) scopeKind = "visual";
  else if (t.scope_project_id) scopeKind = "project";
  return {
    name: t.name,
    body: t.body,
    scopeKind,
    scopeProjectId: t.scope_project_id ?? "",
    scopeVisualId: t.scope_visual_id ?? "",
    varSchema: t.var_schema ? [...t.var_schema] : [],
    examples: t.examples ? t.examples.map((r) => ({ ...r })) : [],
  };
}

export function Builder({
  id,
  templates,
  projects,
  visuals,
  onBack,
  onSaved,
  onDeleted,
}: BuilderProps) {
  const existing = id ? templates.find((t) => t.id === id) ?? null : null;
  const isBuiltin = !!existing?.is_builtin;

  const [form, setForm] = useState<FormState>(() =>
    existing ? deriveForm(existing) : emptyForm(),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setForm(existing ? deriveForm(existing) : emptyForm());
    setErr(null);
  }, [existing]);

  const bodyVarNames = useMemo(() => extractVarNames(form.body), [form.body]);

  const projectVisuals = useMemo(() => {
    if (!form.scopeProjectId) return visuals;
    return visuals.filter((v) => v.project_id === form.scopeProjectId);
  }, [visuals, form.scopeProjectId]);

  function patch<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((cur) => ({ ...cur, [k]: v }));
  }

  function updateVar(idx: number, p: Partial<VarSchemaItem>) {
    setForm((cur) => ({
      ...cur,
      varSchema: cur.varSchema.map((it, i) => (i === idx ? { ...it, ...p } : it)),
    }));
  }
  function addVar() {
    setForm((cur) =>
      cur.varSchema.length >= MAX_VARS
        ? cur
        : { ...cur, varSchema: [...cur.varSchema, blankSchemaItem()] },
    );
  }
  function removeVar(idx: number) {
    setForm((cur) => ({
      ...cur,
      varSchema: cur.varSchema.filter((_, i) => i !== idx),
    }));
  }

  function updateRef(idx: number, p: Partial<ReferenceItem>) {
    setForm((cur) => ({
      ...cur,
      examples: cur.examples.map((it, i) => (i === idx ? { ...it, ...p } : it)),
    }));
  }
  function addRef() {
    setForm((cur) => {
      if (cur.examples.length >= MAX_REFERENCES) return cur;
      const slot = nextRefSlot(cur.examples);
      if (!slot) return cur;
      const next: ReferenceItem = { name: slot, visual_id: "", visual_version: null };
      return { ...cur, examples: [...cur.examples, next] };
    });
  }
  function removeRef(idx: number) {
    setForm((cur) => ({
      ...cur,
      examples: cur.examples.filter((_, i) => i !== idx),
    }));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      body: form.body,
      var_names: form.varSchema.map((v) => v.name).filter((n) => n.length > 0),
      var_schema:
        form.varSchema.length > 0
          ? (form.varSchema.filter((v) => v.name.length > 0) as VarSchema)
          : null,
      examples:
        form.examples.length > 0
          ? form.examples.filter((r) => r.visual_id.length > 0)
          : null,
      scope_project_id:
        form.scopeKind === "project" ? form.scopeProjectId || null : null,
      scope_visual_id:
        form.scopeKind === "visual" ? form.scopeVisualId || null : null,
    };
    try {
      const url = id ? `/api/send-templates/${id}` : "/api/send-templates";
      const method = id ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json().catch(() => ({}))) as { id?: string; error?: string } & SendTemplate;
      if (!r.ok) {
        setErr(data.error ?? `Save failed (${r.status})`);
        return;
      }
      onSaved(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow() {
    if (busy || !id || isBuiltin) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/send-templates/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? `Delete failed (${r.status})`);
        return;
      }
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (busy || !id) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/send-templates/${id}/duplicate`, { method: "POST" });
      const data = (await r.json().catch(() => ({}))) as { id?: string; error?: string } & SendTemplate;
      if (!r.ok) {
        setErr(data.error ?? `Duplicate failed (${r.status})`);
        return;
      }
      onSaved(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel =
    form.scopeKind === "global"
      ? "global scope"
      : form.scopeKind === "project"
        ? `project · ${projects.find((p) => p.id === form.scopeProjectId)?.name ?? "—"}`
        : `visual · ${visuals.find((v) => v.id === form.scopeVisualId)?.title ?? "—"}`;

  return (
    <div className="tpl-page">
      <main className="tpl-body">
        <header className="page-header">
          <div className="ph-l">
            <span className="ph-mark" aria-hidden="true">
              <img src={MARK_SRC} alt="" />
            </span>
            <div>
              <h1>
                {id ? form.name || existing?.name || "Template" : "New template"}
                <em>{id ? " · editing" : ""}</em>
              </h1>
            <div className="meta-line">
              {scopeLabel}
              {existing?.current_version_num && (
                <>
                  <span className="sep">·</span>
                  <strong>v{existing.current_version_num}</strong> current
                </>
              )}
              <span className="sep">·</span>
              uses <strong>{form.varSchema.length} vars</strong>
              {form.examples.length > 0 && (
                <>
                  <span className="sep">·</span>
                  <strong>{form.examples.length} refs</strong>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="ph-r">
          <button type="button" className="btn ghost" onClick={onBack}>
            ↶ back to templates
          </button>
        </div>
      </header>
        {isBuiltin && (
          <p className="builtin-note">
            <strong>Built-in.</strong> Editable in place — changes persist
            locally. Scope stays global. Use <strong>duplicate</strong> to fork
            into a new saved row, or edit here.
          </p>
        )}
        {id && FORMAT_AFFINITY[id] && (
          <p className="tpl-affinity" role="note" style={{ marginBottom: "var(--s-3)" }}>
            {FORMAT_AFFINITY[id]}
          </p>
        )}
        {err && <p style={{ color: "var(--terra-deep)" }}>Error: {err}</p>}

        <div className="edit-grid">
          <div className="edit-stack">

            {/* Tier 01 · Identity & scope */}
            <section className="panel">
              <div className="panel-head">
                <span className="step">01</span>
                <span className="label">Identity &amp; scope</span>
                <span className="opt">required</span>
              </div>
              <div className="panel-body">
                <div className="field">
                  <label className="field-label" htmlFor="tpl-name">Name</label>
                  <input
                    id="tpl-name"
                    type="text"
                    className="tpl-name-input"
                    value={form.name}
                    onChange={(e) => patch("name", e.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label">Scope</label>
                  <div className="scope-seg">
                    {(["global", "project", "visual"] as ScopeKind[]).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={form.scopeKind === kind ? "on" : ""}
                        disabled={isBuiltin}
                        onClick={() => {
                          patch("scopeKind", kind);
                          if (kind === "global") {
                            patch("scopeProjectId", "");
                            patch("scopeVisualId", "");
                          } else if (kind === "project") {
                            patch("scopeVisualId", "");
                          } else if (kind === "visual") {
                            patch("scopeProjectId", "");
                          }
                        }}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                  {form.scopeKind === "project" && (
                    <div className="scope-pickers">
                      <select
                        className="tpl-scope-select"
                        value={form.scopeProjectId}
                        disabled={isBuiltin}
                        onChange={(e) => patch("scopeProjectId", e.target.value)}
                      >
                        <option value="">Pick a project…</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.scopeKind === "visual" && (
                    <div className="scope-pickers">
                      <select
                        className="tpl-scope-select"
                        value={form.scopeProjectId}
                        disabled={isBuiltin}
                        onChange={(e) => {
                          patch("scopeProjectId", e.target.value);
                          patch("scopeVisualId", "");
                        }}
                      >
                        <option value="">All projects</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="tpl-scope-select"
                        value={form.scopeVisualId}
                        disabled={isBuiltin}
                        onChange={(e) => patch("scopeVisualId", e.target.value)}
                      >
                        <option value="">Pick a visual…</option>
                        {projectVisuals.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Tier 02 · Body */}
            <section className="panel">
              <div className="panel-head">
                <span className="step">02</span>
                <span className="label">Body</span>
                <span className="opt">use {"{{var}}"} + {"{{refN}}"}</span>
              </div>
              <div className="panel-body">
                <textarea
                  id="tpl-body"
                  className="body-editor"
                  value={form.body}
                  onChange={(e) => patch("body", e.target.value)}
                  placeholder="Iterate visual {{id}} ({{title}}, v{{ver}}) — {{change}}"
                />
                {bodyVarNames.length > 0 && (
                  <div className="var-pills">
                    {bodyVarNames.map((n) => (
                      <span key={n} className="var-pill">
                        {`{{${n}}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Tier 03 · Variables */}
            <section className="panel">
              <div className="panel-head">
                <span className="step">03</span>
                <span className="label">Variables</span>
                <span className="opt">
                  {form.varSchema.length > 0
                    ? `${form.varSchema.length} / ${MAX_VARS} declared`
                    : `${bodyVarNames.length} detected in body`}
                  {form.varSchema.filter((v) => v.required).length > 0 &&
                    ` · ${form.varSchema.filter((v) => v.required).length} required`}
                </span>
              </div>
              <div className="panel-body">
                {form.varSchema.length > 0 ? (
                  <div className="var-grid">
                    <span className="vh">name</span>
                    <span className="vh">type</span>
                    <span className="vh">req</span>
                    <span className="vh">default / options</span>
                    <span />
                    {form.varSchema.map((v, i) => (
                      <VarRow
                        key={i}
                        item={v}
                        disabled={false}
                        onChange={(p) => updateVar(i, p)}
                        onRemove={() => removeVar(i)}
                      />
                    ))}
                  </div>
                ) : bodyVarNames.length > 0 ? (
                  <div className="var-readonly">
                    {bodyVarNames.map((n) => (
                      <span key={n} className="var-readonly-row">
                        <span className="rn">{`{{${n}}}`}</span>
                        <span className="rt">string · auto</span>
                      </span>
                    ))}
                    {!isBuiltin && (
                      <p className="var-readonly-hint">
                        Detected from body. Click <strong>+ declare variable</strong> to set type, required, or default.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="var-readonly-hint" style={{ margin: 0 }}>
                    No variables yet. Add <code>{"{{name}}"}</code> placeholders to the body, then declare them here.
                  </p>
                )}
                <button
                  type="button"
                  className="var-add"
                  onClick={addVar}
                  disabled={form.varSchema.length >= MAX_VARS}
                >
                  + declare variable
                </button>
              </div>
            </section>

            {/* Tier 04 · References */}
            <section className="panel">
              <div className="panel-head">
                <span className="step">04</span>
                <span className="label">References</span>
                <span className="opt">
                  {form.examples.length} / {MAX_REFERENCES} · placed via {"{{refN}}"}
                </span>
              </div>
              <div className="panel-body">
                {form.examples.map((r, i) => (
                  <RefRow
                    key={i}
                    row={r}
                    disabled={false}
                    projects={projects}
                    visuals={visuals}
                    onChange={(p) => updateRef(i, p)}
                    onRemove={() => removeRef(i)}
                  />
                ))}
                <button
                  type="button"
                  className="ref-add"
                  onClick={addRef}
                  disabled={form.examples.length >= MAX_REFERENCES}
                >
                  + add reference
                </button>
              </div>
            </section>
          </div>

          {/* Sticky live render */}
          <LivePane
            body={form.body}
            varSchema={form.varSchema}
            bodyVarNames={bodyVarNames}
            examples={form.examples}
            visuals={visuals}
          />
        </div>

        <div className="edit-bar">
          <span className="breadcrumb">
            {id ? (
              <>
                <b title={id}>{isBuiltin ? "built-in" : id.slice(0, 6)}</b>
                {existing?.current_version_num && <> · v{existing.current_version_num}</>}
                {" · "}{form.scopeKind}
              </>
            ) : (
              <>new template · unsaved</>
            )}
          </span>
          <span className="saved">
            <span className="saved-dot" />
            {busy ? "saving…" : id ? "ready" : "draft"}
          </span>
          <span className="actions">
            {id && !isBuiltin && (
              <button
                type="button"
                className="btn"
                style={{ color: "var(--terra-deep)", borderColor: "var(--terra-deep)" }}
                onClick={() => {
                  if (window.confirm("Delete this template? This cannot be undone.")) {
                    void deleteRow();
                  }
                }}
                disabled={busy}
              >
                delete
              </button>
            )}
            {id && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => void duplicate()}
                disabled={busy}
              >
                duplicate
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {id ? "save changes" : "create template"}
            </button>
          </span>
        </div>
      </main>
    </div>
  );
}

interface LivePaneProps {
  body: string;
  varSchema: VarSchemaItem[];
  bodyVarNames: string[];
  examples: ReferenceItem[];
  visuals: Visual[];
}

function LivePane({ body, varSchema, bodyVarNames, examples, visuals }: LivePaneProps) {
  void visuals; // reserved for future ref hover-preview
  // Resolve {{var}} → schema.default || `<var>`; {{refN}} → magpie://visual/<id>[/vN]
  const varMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of varSchema) {
      if (v.name) m.set(v.name, v.default ?? `<${v.name}>`);
    }
    return m;
  }, [varSchema]);
  const refMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of examples) {
      if (r.visual_id) {
        const uri =
          r.visual_version != null
            ? `magpie://visual/${r.visual_id}/v${r.visual_version}`
            : `magpie://visual/${r.visual_id}`;
        m.set(r.name, uri);
      }
    }
    return m;
  }, [examples]);

  const nodes = useMemo(() => {
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    const out: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = re.exec(body)) !== null) {
      if (m.index > lastIdx) out.push(body.slice(lastIdx, m.index));
      const name = m[1];
      if (refMap.has(name)) {
        out.push(
          <span className="ref-inline" key={key++}>
            {refMap.get(name)}
          </span>,
        );
      } else if (varMap.has(name)) {
        out.push(
          <span className="subst" key={key++}>
            {varMap.get(name)}
          </span>,
        );
      } else {
        // Unmapped — declared in body but no schema row. Show as neutral
        // mono pill (not terra warning) because the var is still valid;
        // it just has no sample/default to substitute yet.
        out.push(
          <span className="subst placeholder" key={key++}>
            {`{{${name}}}`}
          </span>,
        );
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < body.length) out.push(body.slice(lastIdx));
    return out;
  }, [body, varMap, refMap]);

  const chars = body.length;
  const tokens = Math.max(1, Math.round(chars / 4));
  // Vars stat: prefer schema (typed); fall back to body-detected names
  // when schema empty so built-ins still surface their var count.
  const totalVars = varSchema.length > 0 ? varSchema.length : bodyVarNames.length;
  const filledVars =
    varSchema.length > 0
      ? varSchema.filter((v) => v.name && (v.default || !v.required)).length
      : bodyVarNames.length;
  const filledRefs = examples.filter((r) => !!r.visual_id).length;
  const totalRefs = examples.length;
  const varsOk = filledVars === totalVars && totalVars > 0;
  const refsOk = filledRefs === totalRefs && totalRefs > 0;

  return (
    <aside className="live-pane">
      <div className="live-head">
        <span className="lbl">Live render</span>
        <span className="sub">what they'll read</span>
      </div>
      <div className="live-body">
        {body.length === 0 ? (
          <span style={{ color: "var(--text-subtle)", fontStyle: "italic" }}>
            Start typing in the body editor →
          </span>
        ) : (
          nodes
        )}
      </div>
      {varSchema.filter((v) => v.name).length > 0 && (
        <div className="live-samples">
          <div className="h">Sample values</div>
          {varSchema
            .filter((v) => v.name)
            .map((v) => (
              <div className="sample-row" key={v.name}>
                <span className="vn">{v.name}</span>
                <span className="vi">{v.default || `<${v.name}>`}</span>
              </div>
            ))}
        </div>
      )}
      <div className="live-stats">
        <div className="stat-row">
          <span className="k">Chars</span>
          <span className="v">{chars}</span>
        </div>
        <div className="stat-row">
          <span className="k">Tokens (est)</span>
          <span className="v">~{tokens}</span>
        </div>
        <div className={`stat-row${totalVars > 0 ? (varsOk ? " ok" : " warn") : ""}`}>
          <span className="k">Vars</span>
          <span className="v">
            {filledVars} / {totalVars}
            {totalVars > 0 && (varsOk ? " ✓" : " ⚠")}
          </span>
        </div>
        <div className={`stat-row${totalRefs > 0 ? (refsOk ? " ok" : " warn") : ""}`}>
          <span className="k">Refs</span>
          <span className="v">
            {filledRefs} / {totalRefs}
            {totalRefs > 0 && (refsOk ? " ✓" : " ⚠")}
          </span>
        </div>
      </div>
    </aside>
  );
}

interface VarRowProps {
  item: VarSchemaItem;
  disabled: boolean;
  onChange: (p: Partial<VarSchemaItem>) => void;
  onRemove: () => void;
}

function VarRow({ item, disabled, onChange, onRemove }: VarRowProps) {
  return (
    <>
      <input
        type="text"
        value={item.name}
        disabled={disabled}
        onChange={(e) =>
          onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })
        }
        placeholder="var_name"
      />
      <select
        value={item.type}
        disabled={disabled}
        onChange={(e) =>
          onChange({
            type: e.target.value as VarSchemaItem["type"],
            ...(e.target.value === "enum" && !item.options
              ? { options: ["option_a", "option_b"] }
              : {}),
          })
        }
      >
        <option value="string">string</option>
        <option value="multiline">multiline</option>
        <option value="enum">enum</option>
      </select>
      <input
        type="checkbox"
        className="var-req-cb"
        checked={!!item.required}
        disabled={disabled}
        onChange={(e) => onChange({ required: e.target.checked })}
      />
      {item.type === "enum" ? (
        <input
          type="text"
          value={(item.options ?? []).join(",")}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              options: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
          placeholder="option_a, option_b"
        />
      ) : (
        <input
          type="text"
          value={item.default ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ default: e.target.value })}
          placeholder="(optional default)"
        />
      )}
      {!disabled ? (
        <button type="button" className="x" onClick={onRemove} title="remove variable">
          ×
        </button>
      ) : (
        <span />
      )}
    </>
  );
}

interface RefRowProps {
  row: ReferenceItem;
  disabled: boolean;
  projects: Project[];
  visuals: Visual[];
  onChange: (p: Partial<ReferenceItem>) => void;
  onRemove: () => void;
}

function RefRow({
  row,
  disabled,
  projects,
  visuals,
  onChange,
  onRemove,
}: RefRowProps) {
  const visual = visuals.find((v) => v.id === row.visual_id) ?? null;
  const [pickedProj, setPickedProj] = useState<string>(
    visual ? visual.project_id : "",
  );
  const projectVisuals = pickedProj
    ? visuals.filter((v) => v.project_id === pickedProj)
    : visuals;
  const pinned = row.visual_version != null;
  return (
    <div className="ref-row">
      <div className="rname">{`{{${row.name}}}`}</div>
      <div className="ref-pickers">
        <select
          value={pickedProj}
          disabled={disabled}
          onChange={(e) => {
            setPickedProj(e.target.value);
            onChange({ visual_id: "", visual_version: null });
          }}
          aria-label="project filter"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={row.visual_id}
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value;
            const next = visuals.find((v) => v.id === id) ?? null;
            if (next && !pickedProj) setPickedProj(next.project_id);
            onChange({ visual_id: id, visual_version: null });
          }}
          aria-label="visual"
        >
          <option value="">Pick a visual…</option>
          {projectVisuals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
      </div>
      <label className="ref-pin">
        <input
          type="checkbox"
          checked={pinned}
          disabled={disabled || !visual}
          onChange={(e) => {
            const cur = visual?.current_ver ?? 1;
            const next = togglePin(row, cur, e.target.checked);
            onChange({ visual_version: next.visual_version });
          }}
        />
        <span>pin v{visual?.current_ver ?? "?"}</span>
      </label>
      {!disabled && (
        <button type="button" className="x" onClick={onRemove} title="remove reference">
          ×
        </button>
      )}
    </div>
  );
}
