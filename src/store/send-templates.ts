import { z } from "zod";
import { getDb } from "./db.js";
import { newId, nowIso } from "./ids.js";

export const VAR_NAME_RE = /^[a-z][a-z0-9_]{0,15}$/;
export const MAX_VARS = 5;
export const NAME_MIN = 1;
export const NAME_MAX = 60;

// S5 P1.B — typed var schema. Q1 lock: applies to user templates only.
// null var_schema = legacy mustache template (back-compat).
export const varSchemaItemZod = z
  .object({
    name: z.string().regex(VAR_NAME_RE),
    type: z.enum(["string", "multiline", "enum"]),
    required: z.boolean().optional(),
    default: z.string().optional(),
    label: z.string().max(NAME_MAX).optional(),
    options: z.array(z.string()).optional(),
  })
  .refine(
    (v) => v.type !== "enum" || (Array.isArray(v.options) && v.options.length > 0),
    { message: "enum type requires non-empty options array" }
  );

export const varSchemaZod = z
  .array(varSchemaItemZod)
  .max(MAX_VARS)
  .refine(
    (arr) => new Set(arr.map((v) => v.name)).size === arr.length,
    { message: "duplicate var name in schema" }
  );

export type VarSchemaItem = z.infer<typeof varSchemaItemZod>;
export type VarSchema = z.infer<typeof varSchemaZod>;

// S8 P2.B — visual references replace text examples (R16 supersedes R13).
// Cap 3 carries forward from R13 examples — same guardrail against bloat.
// Names are server-validated (^ref[1-3]$); the dashboard auto-assigns them.
// visual_id is a non-empty string; FK existence is verified at the store
// boundary by validateReferences below. visual_version: null = always-current,
// integer >= 1 = pinned to a specific version. The col continues to be named
// `examples` (no rename) — only the JSON shape changes.
export const MAX_REFERENCES = 3;
export const REF_NAME_RE = /^ref[1-3]$/;

export const referenceItemZod = z.object({
  name: z.string().regex(REF_NAME_RE),
  visual_id: z.string().min(1),
  visual_version: z.number().int().min(1).nullable(),
});
export const referencesZod = z
  .array(referenceItemZod)
  .max(MAX_REFERENCES)
  .refine(
    (arr) => new Set(arr.map((r) => r.name)).size === arr.length,
    { message: "duplicate ref name" },
  );
export type ReferenceItem = z.infer<typeof referenceItemZod>;
export type References = z.infer<typeof referencesZod>;

// Legacy text-example types kept temporarily during the P2 cut-over so
// existing UI files (Examples.tsx, Builder.tsx) keep compiling until
// P3 + P5 finish the swap. Migration 012 already cleared the data.
export const MAX_EXAMPLES = 3;

export const examplesItemZod = z.object({
  input: z.string(),
  output: z.string(),
});
export const examplesZod = z.array(examplesItemZod).max(MAX_EXAMPLES);
export type ExampleItem = z.infer<typeof examplesItemZod>;
export type Examples = z.infer<typeof examplesZod>;

export interface SendTemplate {
  id: string;
  name: string;
  body: string;
  var_names: string[];
  var_schema: VarSchema | null;
  // S8 P2.C — `examples` JSON col now holds References shape (R16 supersedes
  // R13). Col name kept for back-compat; JSON content changes shape only.
  // Denormalized from the current version via LEFT JOIN on send_template_versions.
  examples: References | null;
  is_builtin: boolean;
  sort_order: number;
  created_at: string;
  current_version_num: number;
  // S7 P2.B — optional scope. Both null = global. Exactly one set = scoped.
  // Builtins (`is_builtin === true`) are always global; the store rejects
  // any builtin row that arrives with either scope column populated.
  scope_project_id: string | null;
  scope_visual_id: string | null;
}

interface SendTemplateRow {
  id: string;
  name: string;
  body: string;
  var_names: string;
  var_schema: string | null;
  current_examples: string | null;
  is_builtin: number;
  sort_order: number;
  created_at: string;
  current_version_num: number;
  scope_project_id: string | null;
  scope_visual_id: string | null;
}

// S5 P3.B — frozen version readable from history. Body + schema +
// examples are immutable for a given (template_id, version_num).
export interface SendTemplateVersion {
  id: string;
  template_id: string;
  version_num: number;
  body: string;
  var_schema: VarSchema | null;
  // S8 P2.C — `examples` JSON col now holds References shape.
  examples: References | null;
  created_at: string;
}

interface SendTemplateVersionRow {
  id: string;
  template_id: string;
  version_num: number;
  body: string;
  var_schema: string | null;
  examples: string | null;
  created_at: string;
}

export interface ValidationFail {
  ok: false;
  reason:
    | "name_required"
    | "name_too_long"
    | "body_required"
    | "var_count_exceeded"
    | "var_name_invalid"
    | "var_duplicate"
    | "schema_invalid"
    | "examples_invalid"
    | "scope_xor_violation"
    | "builtin_must_be_global"
    | "scope_project_not_found"
    | "scope_visual_not_found"
    // S8 P2.B — references replace examples.
    | "references_invalid"
    | "reference_visual_not_found";
}

export interface ValidationOk {
  ok: true;
}

export type ValidationResult = ValidationOk | ValidationFail;

export function validateTemplateInput(
  name: string,
  body: string,
  var_names: string[]
): ValidationResult {
  if (typeof name !== "string" || name.trim().length < NAME_MIN) {
    return { ok: false, reason: "name_required" };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, reason: "name_too_long" };
  }
  if (typeof body !== "string" || body.length === 0) {
    return { ok: false, reason: "body_required" };
  }
  if (var_names.length > MAX_VARS) {
    return { ok: false, reason: "var_count_exceeded" };
  }
  const seen = new Set<string>();
  for (const v of var_names) {
    if (!VAR_NAME_RE.test(v)) {
      return { ok: false, reason: "var_name_invalid" };
    }
    if (seen.has(v)) {
      return { ok: false, reason: "var_duplicate" };
    }
    seen.add(v);
  }
  return { ok: true };
}

function rowToTemplate(row: SendTemplateRow): SendTemplate {
  let parsed: string[] = [];
  try {
    const v = JSON.parse(row.var_names);
    if (Array.isArray(v)) parsed = v.filter((x) => typeof x === "string");
  } catch {
    parsed = [];
  }
  let schema: VarSchema | null = null;
  if (row.var_schema) {
    try {
      const raw = JSON.parse(row.var_schema);
      const validated = varSchemaZod.safeParse(raw);
      if (validated.success) schema = validated.data;
    } catch {
      schema = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    var_names: parsed,
    var_schema: schema,
    examples: parseExamples(row.current_examples),
    is_builtin: row.is_builtin === 1,
    sort_order: row.sort_order,
    created_at: row.created_at,
    current_version_num: row.current_version_num,
    scope_project_id: row.scope_project_id,
    scope_visual_id: row.scope_visual_id,
  };
}

// Single source of truth for the LEFT-JOIN that denormalizes current
// examples onto every SendTemplate read. Single row per template since
// (template_id, version_num) is unique.
const SELECT_TEMPLATES = `
  SELECT t.*, v.examples AS current_examples
    FROM send_templates t
    LEFT JOIN send_template_versions v
      ON v.template_id = t.id AND v.version_num = t.current_version_num`;

// S8 P2.C — col still named `examples`, content is now References shape.
// Legacy text-example rows were nulled by migration 012; any survivors fail
// the zod parse and surface as null (defensive — migration already cleared).
function parseExamples(raw: string | null): References | null {
  if (!raw) return null;
  try {
    const parsed = referencesZod.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseVarSchemaText(raw: string | null): VarSchema | null {
  if (!raw) return null;
  try {
    const parsed = varSchemaZod.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function versionRowToObject(row: SendTemplateVersionRow): SendTemplateVersion {
  return {
    id: row.id,
    template_id: row.template_id,
    version_num: row.version_num,
    body: row.body,
    var_schema: parseVarSchemaText(row.var_schema),
    examples: parseExamples(row.examples),
    created_at: row.created_at,
  };
}

export interface ListTemplatesFilter {
  /** When set, restricts user templates to global + project-scoped (matching) +
   *  visual-scoped (visuals belonging to the project when visualId is also
   *  given). Builtins always come through regardless of context. */
  projectId?: string | null;
  /** When set together with projectId, also includes visual-scoped templates
   *  whose scope_visual_id matches. Without projectId, only the exact
   *  visual match passes the filter. */
  visualId?: string | null;
}

function scopeDistance(
  row: SendTemplateRow,
  projectId: string | null | undefined,
  visualId: string | null | undefined,
): number {
  if (row.scope_visual_id && row.scope_visual_id === visualId) return 0;
  if (row.scope_project_id && row.scope_project_id === projectId) return 1;
  if (row.scope_project_id === null && row.scope_visual_id === null) return 2;
  // Out-of-context scoped row — filter callers should drop these.
  return 99;
}

export function listTemplates(filter?: ListTemplatesFilter): SendTemplate[] {
  const rows = getDb()
    .prepare(
      `${SELECT_TEMPLATES}
        ORDER BY t.is_builtin DESC,
                 CASE WHEN t.is_builtin = 1 THEN t.sort_order ELSE 0 END ASC,
                 t.created_at DESC`
    )
    .all() as SendTemplateRow[];
  if (!filter || (filter.projectId == null && filter.visualId == null)) {
    return rows.map(rowToTemplate);
  }
  const { projectId = null, visualId = null } = filter;
  const inScope = rows.filter((row) => {
    if (row.is_builtin === 1) return true;
    const d = scopeDistance(row, projectId, visualId);
    return d < 99;
  });
  // Stable scope-nearest sort. Builtins keep their original sort_order block;
  // user rows order by scope distance (visual-match · project-match · global)
  // then by created_at DESC inside the same bucket (already in `rows`).
  inScope.sort((a, b) => {
    if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
    if (a.is_builtin === 1) return a.sort_order - b.sort_order;
    return (
      scopeDistance(a, projectId, visualId) -
      scopeDistance(b, projectId, visualId)
    );
  });
  return inScope.map(rowToTemplate);
}

export function getTemplate(id: string): SendTemplate | null {
  const row = getDb()
    .prepare(`${SELECT_TEMPLATES} WHERE t.id = ?`)
    .get(id) as SendTemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

// S7 P2.B — scope shape lifted into its own type for both create + update.
// Both null = global. Exactly one set = scoped. Both set = XOR violation.
export interface ScopeInput {
  scope_project_id?: string | null;
  scope_visual_id?: string | null;
}

export interface CreateTemplateInput extends ScopeInput {
  name: string;
  body: string;
  var_names: string[];
  var_schema?: VarSchema | null;
  // S8 P2.C — `examples` field now holds References (col name kept).
  examples?: References | null;
}

export type CreateResult =
  | { ok: true; template: SendTemplate }
  | ValidationFail;

// S8 P2.C — examples field is now References. Delegates to validateReferences
// so the FK check runs at the same boundary as create + update paths.
function validateAndNormalizeExamples(
  input: References | null | undefined
): { ok: true; examples: References | null } | ValidationFail {
  const result = validateReferences(input);
  if (!result.ok) return result;
  return { ok: true, examples: result.references };
}

// Schema is the source of truth when provided: var_names get derived from it
// so the two surfaces never drift. Callers may still pass var_names alongside
// — they're ignored when var_schema is non-null.
function resolveVarNames(
  schema: VarSchema | null,
  fallback: string[]
): string[] {
  return schema ? schema.map((v) => v.name) : fallback;
}

function validateAndNormalizeSchema(
  input: VarSchema | null | undefined
): { ok: true; schema: VarSchema | null } | ValidationFail {
  if (input == null) return { ok: true, schema: null };
  const parsed = varSchemaZod.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "schema_invalid" };
  return { ok: true, schema: parsed.data };
}

// S7 P2.B — XOR + builtin-must-be-global + FK existence check. Run once at the
// boundary of create / update so the storage layer never holds an invalid pair.
function projectExists(id: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM projects WHERE id = ?")
    .get(id) as { 1?: number } | undefined;
  return row !== undefined;
}

function visualExists(id: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM visuals WHERE id = ?")
    .get(id) as { 1?: number } | undefined;
  return row !== undefined;
}

// S8 P2.B — references validator. Mirrors validateScope shape so the
// store's create + update paths converge on a single boundary. Each ref's
// visual_id is FK-checked against the visuals table. Names must match
// `^ref[1-3]$`. Cap 3. Duplicates rejected. visual_version may be null
// (always-current) or a positive integer (pinned).
export function validateReferences(
  input: References | null | undefined,
): { ok: true; references: References | null } | ValidationFail {
  if (input == null) return { ok: true, references: null };
  const parsed = referencesZod.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "references_invalid" };
  for (const ref of parsed.data) {
    if (!visualExists(ref.visual_id)) {
      return { ok: false, reason: "reference_visual_not_found" };
    }
  }
  return { ok: true, references: parsed.data };
}

export function validateScope(
  input: ScopeInput,
  isBuiltin: boolean,
): { ok: true; scope_project_id: string | null; scope_visual_id: string | null } | ValidationFail {
  const proj = input.scope_project_id ?? null;
  const vis = input.scope_visual_id ?? null;
  if (proj !== null && vis !== null) {
    return { ok: false, reason: "scope_xor_violation" };
  }
  if (isBuiltin && (proj !== null || vis !== null)) {
    return { ok: false, reason: "builtin_must_be_global" };
  }
  if (proj !== null && !projectExists(proj)) {
    return { ok: false, reason: "scope_project_not_found" };
  }
  if (vis !== null && !visualExists(vis)) {
    return { ok: false, reason: "scope_visual_not_found" };
  }
  return { ok: true, scope_project_id: proj, scope_visual_id: vis };
}

export function createTemplate(input: CreateTemplateInput): CreateResult {
  const schemaResult = validateAndNormalizeSchema(input.var_schema);
  if (!schemaResult.ok) return schemaResult;
  const schema = schemaResult.schema;
  const examplesResult = validateAndNormalizeExamples(input.examples);
  if (!examplesResult.ok) return examplesResult;
  const examples = examplesResult.examples;
  const effectiveVarNames = resolveVarNames(schema, input.var_names);
  const v = validateTemplateInput(input.name, input.body, effectiveVarNames);
  if (!v.ok) return v;
  // S7 P2.B — user-created templates are never builtins, but validateScope
  // keeps the same shape contract used by future seeders / migrations.
  const scopeResult = validateScope(
    {
      scope_project_id: input.scope_project_id,
      scope_visual_id: input.scope_visual_id,
    },
    false,
  );
  if (!scopeResult.ok) return scopeResult;
  const t: SendTemplate = {
    id: newId(),
    name: input.name.trim(),
    body: input.body,
    var_names: effectiveVarNames,
    var_schema: schema,
    examples,
    is_builtin: false,
    sort_order: 0,
    created_at: nowIso(),
    current_version_num: 1,
    scope_project_id: scopeResult.scope_project_id,
    scope_visual_id: scopeResult.scope_visual_id,
  };
  const db = getDb();
  const insertTemplate = db.transaction(() => {
    db.prepare(
      `INSERT INTO send_templates
        (id, name, body, var_names, var_schema, is_builtin, sort_order, created_at, current_version_num, scope_project_id, scope_visual_id)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 1, ?, ?)`
    ).run(
      t.id,
      t.name,
      t.body,
      JSON.stringify(t.var_names),
      schema ? JSON.stringify(schema) : null,
      t.created_at,
      t.scope_project_id,
      t.scope_visual_id,
    );
    db.prepare(
      `INSERT INTO send_template_versions
        (id, template_id, version_num, body, var_schema, examples, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    ).run(
      `${t.id}-v1`,
      t.id,
      t.body,
      schema ? JSON.stringify(schema) : null,
      examples ? JSON.stringify(examples) : null,
      t.created_at
    );
  });
  insertTemplate();
  return { ok: true, template: t };
}

export interface UpdateTemplateInput {
  name?: string;
  body?: string;
  var_names?: string[];
  // null = clear schema (revert to legacy mustache); undefined = keep current.
  var_schema?: VarSchema | null;
  // S8 P2.C — `examples` field now holds References. null = clear; undefined =
  // keep current; array sets. Same patch semantics as before.
  examples?: References | null;
  // S7 P2.B — scope patch. undefined = keep current; null = clear that side;
  // exactly one set across both = scope to that entity; both set = XOR error.
  // The builder UI sends both fields together when changing scope so the
  // store can treat the pair atomically (a single radio click = both fields
  // in the patch).
  scope_project_id?: string | null;
  scope_visual_id?: string | null;
}

export type UpdateResult =
  | { ok: true; template: SendTemplate }
  | { ok: false; reason: "not_found" }
  | ValidationFail;

// Decide if an update changes any version-tracked field (body / var_schema /
// examples). Name-only renames don't bump the version pointer — they're
// metadata, not template content. Same for typo-fix-then-undo: if the
// resolved (body, schema, examples) tuple matches the current version,
// we skip the version insert too.
function isContentChange(
  existing: SendTemplate,
  next: { body: string; var_schema: VarSchema | null; examples: References | null },
  currentExamples: References | null
): boolean {
  if (existing.body !== next.body) return true;
  if (JSON.stringify(existing.var_schema) !== JSON.stringify(next.var_schema)) return true;
  if (JSON.stringify(currentExamples) !== JSON.stringify(next.examples)) return true;
  return false;
}

// v0.9.3 Phase F polish — built-ins are editable (Owner decision 2026-05-18).
// Scope on built-ins still rejected via validateScope's builtin_must_be_global
// reason; delete on built-ins still rejected to keep the canonical seed intact.
export function updateTemplate(id: string, input: UpdateTemplateInput): UpdateResult {
  const existing = getTemplate(id);
  if (!existing) return { ok: false, reason: "not_found" };
  let schema: VarSchema | null;
  if (input.var_schema === undefined) {
    schema = existing.var_schema;
  } else {
    const result = validateAndNormalizeSchema(input.var_schema);
    if (!result.ok) return result;
    schema = result.schema;
  }
  const currentVersion = getSendTemplateVersion(id, existing.current_version_num);
  const currentExamples = currentVersion?.examples ?? null;
  let examples: References | null;
  if (input.examples === undefined) {
    examples = currentExamples;
  } else {
    const result = validateAndNormalizeExamples(input.examples);
    if (!result.ok) return result;
    examples = result.examples;
  }
  // S7 P2.B — scope patch. We treat the pair as one unit: if either side is
  // specified in the patch, we re-evaluate XOR + FK against the resolved
  // pair (specified side new, unspecified side reused from existing).
  const scopeProjPatch = input.scope_project_id !== undefined;
  const scopeVisPatch = input.scope_visual_id !== undefined;
  let nextScopeProjectId = existing.scope_project_id;
  let nextScopeVisualId = existing.scope_visual_id;
  if (scopeProjPatch || scopeVisPatch) {
    const candidate: ScopeInput = {
      scope_project_id: scopeProjPatch
        ? input.scope_project_id ?? null
        : existing.scope_project_id,
      scope_visual_id: scopeVisPatch
        ? input.scope_visual_id ?? null
        : existing.scope_visual_id,
    };
    const scopeResult = validateScope(candidate, existing.is_builtin);
    if (!scopeResult.ok) return scopeResult;
    nextScopeProjectId = scopeResult.scope_project_id;
    nextScopeVisualId = scopeResult.scope_visual_id;
  }
  const next = {
    name: input.name ?? existing.name,
    body: input.body ?? existing.body,
    var_names: resolveVarNames(schema, input.var_names ?? existing.var_names),
  };
  const v = validateTemplateInput(next.name, next.body, next.var_names);
  if (!v.ok) return v;
  const contentChanged = isContentChange(
    existing,
    { body: next.body, var_schema: schema, examples },
    currentExamples
  );
  const scopeChanged =
    nextScopeProjectId !== existing.scope_project_id ||
    nextScopeVisualId !== existing.scope_visual_id;
  const db = getDb();
  const tx = db.transaction(() => {
    if (contentChanged) {
      // Immutable on edit: insert a new version row, advance the pointer,
      // and refresh the denormalized current copy on send_templates.
      const newVer = existing.current_version_num + 1;
      const createdAt = nowIso();
      db.prepare(
        `INSERT INTO send_template_versions
          (id, template_id, version_num, body, var_schema, examples, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `${id}-v${newVer}`,
        id,
        newVer,
        next.body,
        schema ? JSON.stringify(schema) : null,
        examples ? JSON.stringify(examples) : null,
        createdAt
      );
      db.prepare(
        `UPDATE send_templates
            SET name = ?, body = ?, var_names = ?, var_schema = ?, current_version_num = ?,
                scope_project_id = ?, scope_visual_id = ?
          WHERE id = ?`
      ).run(
        next.name.trim(),
        next.body,
        JSON.stringify(next.var_names),
        schema ? JSON.stringify(schema) : null,
        newVer,
        nextScopeProjectId,
        nextScopeVisualId,
        id
      );
    } else if (scopeChanged) {
      // Scope-only patch (or scope + rename) — no new version, just metadata.
      db.prepare(
        `UPDATE send_templates
            SET name = ?, scope_project_id = ?, scope_visual_id = ?
          WHERE id = ?`
      ).run(next.name.trim(), nextScopeProjectId, nextScopeVisualId, id);
    } else {
      // Name-only / no-op — skip versioning, just update metadata.
      db.prepare(
        `UPDATE send_templates SET name = ? WHERE id = ?`
      ).run(next.name.trim(), id);
    }
  });
  tx();
  return { ok: true, template: getTemplate(id)! };
}

// S5 P3.B — version readers.
export function getSendTemplateVersion(
  template_id: string,
  version_num: number
): SendTemplateVersion | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM send_template_versions
        WHERE template_id = ? AND version_num = ?`
    )
    .get(template_id, version_num) as SendTemplateVersionRow | undefined;
  return row ? versionRowToObject(row) : null;
}

export function listSendTemplateVersions(
  template_id: string,
  limit?: number
): SendTemplateVersion[] {
  const cap = limit ?? 50;
  const rows = getDb()
    .prepare(
      `SELECT * FROM send_template_versions
        WHERE template_id = ?
        ORDER BY version_num DESC
        LIMIT ?`
    )
    .all(template_id, cap) as SendTemplateVersionRow[];
  return rows.map(versionRowToObject);
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "is_builtin" };

export function deleteTemplate(id: string): DeleteResult {
  const existing = getTemplate(id);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.is_builtin) return { ok: false, reason: "is_builtin" };
  getDb().prepare("DELETE FROM send_templates WHERE id = ?").run(id);
  return { ok: true };
}
