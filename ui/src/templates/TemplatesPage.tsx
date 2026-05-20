// S7 P4.C — list + edit page shown by /templates.
// v0.9.3 Phase F3b polish — Templates rework: specimen-card grid +
// scope chip-row + ph-mark plate per mock magpie://visual/f5RytaUpi4xa v8.

import { useEffect, useMemo, useState } from "react";
import type { SendTemplate } from "../send-template-utils";
import { Builder } from "./Builder";

export interface TemplatesPageProps {
  activeId: string | null;
  onOpen: (id: string | null) => void;
}

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

type ScopeFilter = "all" | "global" | "project" | "visual" | "builtin";

const MARK_SRC = "/logo-A-v4-faithful.png";

export function TemplatesPage({ activeId, onOpen }: TemplatesPageProps) {
  const [templates, setTemplates] = useState<SendTemplate[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scope, setScope] = useState<ScopeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    Promise.all([
      fetch("/api/send-templates").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`templates ${r.status}`)))),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/visuals").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([t, p, v]) => {
        if (cancelled) return;
        setTemplates(t as SendTemplate[]);
        setProjects(Array.isArray(p) ? (p as Project[]) : []);
        setVisuals(Array.isArray(v) ? (v as Visual[]) : []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  if (activeId !== null) {
    return (
      <Builder
        key={activeId}
        id={activeId === "new" ? null : activeId}
        templates={templates ?? []}
        projects={projects}
        visuals={visuals}
        onBack={() => {
          onOpen(null);
          refresh();
        }}
        onSaved={(saved) => {
          onOpen(saved.id);
          refresh();
        }}
        onDeleted={() => {
          onOpen(null);
          refresh();
        }}
      />
    );
  }

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
                Templates <em>your prompt nest</em>
              </h1>
              <div className="meta-line">
                {templates && (
                  <>
                    <strong>{templates.length}</strong> total
                    <span className="sep">·</span>
                    <strong>{templates.filter((t) => !t.is_builtin).length}</strong> custom
                    <span className="sep">·</span>
                    <strong>{templates.filter((t) => t.is_builtin).length}</strong> built-in
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="ph-r">
            <a className="btn ghost" href="/">
              ↶ back to dashboard
            </a>
            <button type="button" className="btn primary" onClick={() => onOpen("new")}>
              + new template
            </button>
          </div>
        </header>
        {err && <p style={{ color: "var(--terra-deep)" }}>Error: {err}</p>}
        {!templates && !err && <p className="tpl-empty">Loading…</p>}
        {templates && (
          <>
            <ScopeChipRow value={scope} onChange={setScope} templates={templates} />
            <TemplateGrid
              templates={filterByScope(templates, scope)}
              projects={projects}
              visuals={visuals}
              onOpen={onOpen}
            />
          </>
        )}
      </main>
    </div>
  );
}

function filterByScope(templates: SendTemplate[], scope: ScopeFilter): SendTemplate[] {
  switch (scope) {
    case "all":
      return templates;
    case "global":
      return templates.filter((t) => !t.is_builtin && !t.scope_project_id && !t.scope_visual_id);
    case "project":
      return templates.filter((t) => !t.is_builtin && !!t.scope_project_id);
    case "visual":
      return templates.filter((t) => !t.is_builtin && !!t.scope_visual_id);
    case "builtin":
      return templates.filter((t) => t.is_builtin);
  }
}

interface ScopeChipRowProps {
  value: ScopeFilter;
  onChange: (v: ScopeFilter) => void;
  templates: SendTemplate[];
}

function ScopeChipRow({ value, onChange, templates }: ScopeChipRowProps) {
  const counts = useMemo(
    () => ({
      all: templates.length,
      global: templates.filter((t) => !t.is_builtin && !t.scope_project_id && !t.scope_visual_id).length,
      project: templates.filter((t) => !t.is_builtin && !!t.scope_project_id).length,
      visual: templates.filter((t) => !t.is_builtin && !!t.scope_visual_id).length,
      builtin: templates.filter((t) => t.is_builtin).length,
    }),
    [templates],
  );
  const chips: { id: ScopeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "global", label: "Global" },
    { id: "project", label: "Project" },
    { id: "visual", label: "Visual" },
    { id: "builtin", label: "Built-in" },
  ];
  return (
    <div className="tpl-scope-row">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`tpl-scope-chip${value === c.id ? " on" : ""}`}
          onClick={() => onChange(c.id)}
          aria-pressed={value === c.id}
        >
          {c.label} · {counts[c.id]}
        </button>
      ))}
    </div>
  );
}

function projectName(projects: Project[], id: string | null | undefined): string | null {
  if (!id) return null;
  return projects.find((p) => p.id === id)?.name ?? null;
}

function visualTitle(visuals: Visual[], id: string | null | undefined): string | null {
  if (!id) return null;
  return visuals.find((v) => v.id === id)?.title ?? null;
}

function tagForTemplate(t: SendTemplate): { label: string; cls: string } {
  if (t.is_builtin) return { label: "built-in", cls: "spec-tag builtin" };
  if (t.scope_visual_id) return { label: "visual", cls: "spec-tag visual" };
  if (t.scope_project_id) return { label: "project", cls: "spec-tag project" };
  return { label: "global", cls: "spec-tag" };
}

interface TemplateGridProps {
  templates: SendTemplate[];
  projects: Project[];
  visuals: Visual[];
  onOpen: (id: string | null) => void;
}

function TemplateGrid({ templates, projects, visuals, onOpen }: TemplateGridProps) {
  if (templates.length === 0) {
    return <p className="tpl-empty">No templates in this scope yet.</p>;
  }
  return (
    <div className="specimen-grid">
      {templates.map((t) => (
        <Specimen
          key={t.id}
          tpl={t}
          projectLabel={projectName(projects, t.scope_project_id)}
          visualLabel={visualTitle(visuals, t.scope_visual_id)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface SpecimenProps {
  tpl: SendTemplate;
  projectLabel: string | null;
  visualLabel: string | null;
  onOpen: (id: string | null) => void;
}

function Specimen({ tpl, projectLabel, visualLabel, onOpen }: SpecimenProps) {
  const tag = tagForTemplate(tpl);
  const desc = describe(tpl, projectLabel, visualLabel);
  return (
    <article
      className="spec"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(tpl.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(tpl.id);
      }}
    >
      <span className={tag.cls}>{tag.label}</span>
      <div className="spec-render">{renderBodyExcerpt(tpl.body)}</div>
      <div className="spec-meta">
        <div className="top">
          <span className="name">{tpl.name}</span>
        </div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div className="spec-foot">
        <span>vars {tpl.var_names.length}</span>
        <span className="sep">·</span>
        <span>v{tpl.current_version_num ?? 1}</span>
        {!tpl.is_builtin && (
          <>
            <span className="sep">·</span>
            <span className="id" title={tpl.id}>{tpl.id.slice(0, 6)}</span>
          </>
        )}
      </div>
    </article>
  );
}

function describe(_t: SendTemplate, projectLabel: string | null, visualLabel: string | null): string | null {
  // Built-ins skip generic descriptor — their body is self-explanatory.
  if (visualLabel) return `Pinned to “${visualLabel}”.`;
  if (projectLabel) return `Scoped to ${projectLabel}.`;
  return null;
}

// Inline-render body with {{var}} -> .var-chip. Caps at ~360 chars; the
// CSS mask-image fade hides the cutoff visually.
function renderBodyExcerpt(body: string): React.ReactNode[] {
  const MAX = 360;
  const src = body.length > MAX ? body.slice(0, MAX) + "…" : body;
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > lastIdx) out.push(src.slice(lastIdx, m.index));
    out.push(
      <span className="var-chip" key={key++}>
        {m[1]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < src.length) out.push(src.slice(lastIdx));
  return out;
}
