// Pure-fn helpers extracted from WorkbenchHost so they can be unit-tested
// without bringing React + jsdom along (S6 P17).
//
// Anything in here must stay free of `useState`/`useEffect`/DOM access so
// the test suite stays node-env-only.

import {
  defaultsFromSchema,
  type References,
  type SendTemplate,
  type VarSchema,
} from "../send-template-utils";
import type { WorkbenchTemplate } from "./types";

export interface FrozenVersionRow {
  version_num: number;
  body: string;
  var_schema: VarSchema | null;
  // S8 P2.C — `examples` field now holds References (col name kept).
  examples: References | null;
  created_at: string;
}

export function toWorkbenchTemplate(t: SendTemplate): WorkbenchTemplate {
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    varSchema: t.var_schema ?? null,
    examples: t.examples ?? null,
    builtin: t.is_builtin,
    versionNum: t.current_version_num ?? 1,
    scopeProjectId: t.scope_project_id ?? null,
    scopeVisualId: t.scope_visual_id ?? null,
  };
}

export function frozenToWorkbench(
  base: SendTemplate,
  frozen: FrozenVersionRow,
): WorkbenchTemplate {
  return {
    id: base.id,
    name: base.name,
    body: frozen.body,
    varSchema: frozen.var_schema,
    examples: frozen.examples,
    builtin: base.is_builtin,
    versionNum: frozen.version_num,
    scopeProjectId: base.scope_project_id ?? null,
    scopeVisualId: base.scope_visual_id ?? null,
  };
}

// S7 P3.D — derive the chip kind from the WorkbenchTemplate + the host
// archive-status lookup (Q6). Builtins always return `builtin` (never get a
// chip in the palette UI — `built-in` badge takes the slot). When a visual
// scope's visual is archived, we surface `archived` instead of `visual` so
// the muted chip class kicks in.
export function paletteScopeFor(
  t: WorkbenchTemplate,
  archivedVisualIds: Set<string> | null = null,
): { kind: "global" | "project" | "visual" | "archived" | "builtin" } {
  if (t.builtin) return { kind: "builtin" };
  if (t.scopeVisualId) {
    if (archivedVisualIds && archivedVisualIds.has(t.scopeVisualId)) {
      return { kind: "archived" };
    }
    return { kind: "visual" };
  }
  if (t.scopeProjectId) return { kind: "project" };
  return { kind: "global" };
}

export function defaultsFor(
  schema: VarSchema | null,
  varNames: string[],
): Record<string, string> {
  if (schema) return defaultsFromSchema(schema);
  const out: Record<string, string> = {};
  for (const n of varNames) out[n] = n === "count" ? "3" : "";
  return out;
}

// S7 P6.A — exact clipboard payload format. Extracted so unit tests can
// pin the string shape without mocking navigator.clipboard. Callers in
// App.tsx + WorkbenchIsland.tsx use this same helper.
export function clipboardCommandForInbox(id: string): string {
  return `magpie read_inbox id=${id}`;
}

// S7 P6.D — autoCopyEnabled reads the localStorage opt-out key. Default
// is `on`; only the explicit `"off"` string opts out. Falls back to true
// in non-browser contexts (SSR / tests).
export function autoCopyEnabled(
  storage: { getItem(k: string): string | null } | null,
): boolean {
  if (!storage) return true;
  return storage.getItem("magpie.workbench.auto-copy") !== "off";
}

export function formatWhen(iso: string, now: number = Date.now()): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const dt = (now - d.getTime()) / 1000;
    if (dt < 60) return "just now";
    if (dt < 3600) return `${Math.floor(dt / 60)}m`;
    if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
    return `${Math.floor(dt / 86400)}d`;
  } catch {
    return "";
  }
}
