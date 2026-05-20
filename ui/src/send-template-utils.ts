export const VAR_NAME_RE = /^[a-z][a-z0-9_]{0,15}$/;
export const MAX_VARS = 5;
export const SYSTEM_VARS = new Set(["id", "title", "ver"]);
// S8 P4.C — ref vars get their own set so `extractVarNames` can filter them
// out of user-var enumeration and the lint rule can iterate them
// separately. Kept distinct from SYSTEM_VARS — id/title/ver are intrinsic
// to the visual, refs are template-defined slots resolved at send time.
export const REF_VARS = new Set(["ref1", "ref2", "ref3"]);

export interface VisualForSend {
  id: string;
  title: string;
  current_ver: number;
}

// S5 P1 — typed var schema (mirrors src/store/send-templates.ts shapes).
export type VarType = "string" | "multiline" | "enum";

export interface VarSchemaItem {
  name: string;
  type: VarType;
  required?: boolean;
  default?: string;
  label?: string;
  options?: string[];
}

export type VarSchema = VarSchemaItem[];

// S8 P2.A — visual references replace text examples (R16 supersedes R13).
// Each template carries up to 3 references; users embed them in body via
// `{{refN}}` mustache vars. At send time `resolveReferences()` produces
// `magpie://visual/<id>[/v<n>]` URIs that the LLM (with Magpie MCP loaded)
// reads via ReadResource. Auto-naming (`ref1`/`ref2`/`ref3`) keeps the
// mustache discoverable — users know which row matches which {{refN}}.
export const MAX_REFERENCES = 3;
export const REF_NAME_RE = /^ref[1-3]$/;
export interface ReferenceItem {
  name: string;
  visual_id: string;
  visual_version: number | null;
}
export type References = ReferenceItem[];

// S5 P3 — text examples kept temporarily during P2 cut-over. P3 deletes
// the surface entirely once resolveReferences replaces injectExamples.
export const MAX_EXAMPLES = 3;
export interface ExampleItem {
  input: string;
  output: string;
}
export type Examples = ExampleItem[];

// Server payload for a saved (or built-in) send template. Mirrors
// `src/store/send-templates.ts` row shape over the wire. Lifted here
// from SendToClaudeModal at S6 P16 so neutral consumers can import it
// without dragging the legacy modal along.
export interface SendTemplate {
  id: string;
  name: string;
  body: string;
  var_names: string[];
  var_schema?: VarSchema | null;
  // S8 P2.C — `examples` field now holds References (col name kept).
  examples?: References | null;
  is_builtin: boolean;
  sort_order: number;
  created_at: string;
  current_version_num?: number;
  // S7 P2.B — optional scope. Server omits when both null on legacy rows.
  scope_project_id?: string | null;
  scope_visual_id?: string | null;
}

// S8 P3.B — resolveReferences (replaces injectExamples). Returns the body
// unchanged + a refMap of `{name → magpie:// URI}` for interpolation. The
// LLM (with Magpie MCP loaded) reads `magpie://visual/<id>[/v<n>]` via
// ReadResource on demand — no XML-wrapping, no auto-injection. The user
// controls placement via `{{refN}}` mustache vars in the body.
//
// URI shape mirrors the existing `parseMagpieUri` in src/mcp/resources.ts
// (`magpie://visual/<id>` or `magpie://visual/<id>/v<n>` for pinned).
export interface ResolveReferencesResult {
  body: string;
  refMap: Record<string, string>;
}

export function resolveReferences(
  body: string,
  references: References | null,
): ResolveReferencesResult {
  const refMap: Record<string, string> = {};
  if (!references) return { body, refMap };
  for (const ref of references) {
    const uri =
      ref.visual_version != null
        ? `magpie://visual/${ref.visual_id}/v${ref.visual_version}`
        : `magpie://visual/${ref.visual_id}`;
    refMap[ref.name] = uri;
  }
  return { body, refMap };
}

// Pure-fn defaulter for schema-driven Send modal forms.
// String/multiline: schema's `default` (or empty string).
// Enum: schema's `default` (or first option, or empty if no options).
export function defaultsFromSchema(schema: VarSchema): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of schema) {
    if (v.default !== undefined) {
      out[v.name] = v.default;
    } else if (v.type === "enum" && v.options && v.options.length > 0) {
      out[v.name] = v.options[0];
    } else {
      out[v.name] = "";
    }
  }
  return out;
}

export function extractVarNames(body: string): string[] {
  const re = /\{\{([a-z][a-z0-9_]{0,15})\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (SYSTEM_VARS.has(name)) continue;
    // S8 P4.A — ref vars filter out of the user-var enumeration. They're
    // structural slots, not user-driven inputs; the lint rule iterates them
    // via extractRefNames so warnings stay scoped per kind.
    if (REF_VARS.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// S8 P5 — auto-name helper for the Builder References panel. Picks the
// lowest unused ref slot. Returns null when all three are taken (caller
// is expected to hit the cap UI before calling). Pure-fn — no React.
export function nextRefSlot(
  existing: References,
): "ref1" | "ref2" | "ref3" | null {
  const taken = new Set(existing.map((r) => r.name));
  if (!taken.has("ref1")) return "ref1";
  if (!taken.has("ref2")) return "ref2";
  if (!taken.has("ref3")) return "ref3";
  return null;
}

// S8 P6 — classify a body-pill class purely from the var name + active
// state. Pulled out of `renderBodyWithPills` (Body.tsx) so the kind
// cascade (ref > sys > user) + active highlight semantics are testable.
export type PillKind = "ref" | "sys" | "user";

export function classifyPill(name: string): PillKind {
  if (REF_VARS.has(name)) return "ref";
  if (SYSTEM_VARS.has(name)) return "sys";
  return "user";
}

export function pillClassNames(name: string, activeVar?: string): string {
  const kind = classifyPill(name);
  const active = activeVar === name ? " active" : "";
  if (kind === "ref") return `wb-varref ref${active}`;
  if (kind === "sys") return `wb-varref sys${active}`;
  return `wb-varref${active}`;
}

// S8 P5 — pin/unpin helper. Toggling the pin checkbox flips
// `visual_version` between null (always-current) and the visual's
// current_ver. Centralized here so the Builder UI + tests share one
// shape, and the founder smoke can pin a freshly-added ref one click.
export function togglePin(
  ref: ReferenceItem,
  currentVer: number,
  desired: boolean,
): ReferenceItem {
  if (desired) {
    return { ...ref, visual_version: currentVer };
  }
  return { ...ref, visual_version: null };
}

// S8 P4.A — `extractRefNames(body)` scans for `{{ref[1-3]}}` matches. Used
// by the lint engine (`unreferenced_ref` rule) and the body editor pill
// renderer so refs are flagged distinct from user/system vars.
export function extractRefNames(body: string): string[] {
  const re = /\{\{(ref[1-3])\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// S8 P4.B — `interpolate()` honors an optional refMap so `{{refN}}`
// resolves to `magpie://visual/<id>[/v<n>]` before falling through to
// user values + system vars. refMap is built by resolveReferences().
export function interpolate(
  body: string,
  visual: VisualForSend,
  values: Record<string, string>,
  refMap?: Record<string, string>,
): string {
  return body.replace(/\{\{([a-z][a-z0-9_]{0,15})\}\}/g, (_match, name: string) => {
    if (name === "id") return visual.id;
    if (name === "title") return visual.title || "untitled";
    if (name === "ver") return String(visual.current_ver);
    if (refMap && refMap[name] !== undefined) return refMap[name];
    const v = values[name];
    return v === undefined || v === "" ? `{{${name}}}` : v;
  });
}

export function cloneTitleFor(builtinName: string): string {
  return `${builtinName} (custom)`;
}

// S5 P2.A — preview segment model.
// Splits a template body into ordered text/var segments so the preview
// pane can wrap substitutions in <span class="varpill"> for highlight.
// Pure-fn: no React import here, no JSX. Caller maps segments to nodes.
export type PreviewSegment =
  | { kind: "text"; value: string }
  | {
      kind: "var";
      name: string;
      value: string;
      type: "system" | "user";
      filled: boolean;
    };

// S5 P2.B — Token count approximator. Q3=A: no real tokenizer bundle
// (would add ~1MB of vocab for ~80% accuracy we don't need). chars/4 is
// industry rough estimate (GPT-style BPE averages ~4 chars/token in English).
export function approxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function splitInterpolation(
  body: string,
  visual: VisualForSend,
  values: Record<string, string>,
  refMap?: Record<string, string>,
): PreviewSegment[] {
  const re = /\{\{([a-z][a-z0-9_]{0,15})\}\}/g;
  const segments: PreviewSegment[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ kind: "text", value: body.slice(lastIdx, m.index) });
    }
    const name = m[1];
    if (SYSTEM_VARS.has(name)) {
      let val = "";
      if (name === "id") val = visual.id;
      else if (name === "title") val = visual.title || "untitled";
      else if (name === "ver") val = String(visual.current_ver);
      segments.push({ kind: "var", name, value: val, type: "system", filled: true });
    } else if (refMap && refMap[name] !== undefined) {
      // S8 P4.B/C — refs surface as system-typed segments so the preview's
      // existing `.varpill.sys` styling kicks in. P6 introduces a dedicated
      // `.wb-refpill` class for the body editor, but the preview pre keeps
      // the system-pill style here so resolved URIs visually anchor with
      // id / title / ver substitutions.
      segments.push({
        kind: "var",
        name,
        value: refMap[name],
        type: "system",
        filled: true,
      });
    } else {
      const v = values[name];
      const filled = v !== undefined && v !== "";
      segments.push({
        kind: "var",
        name,
        value: filled ? v : `{{${name}}}`,
        type: "user",
        filled,
      });
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIdx) });
  }
  return segments;
}
