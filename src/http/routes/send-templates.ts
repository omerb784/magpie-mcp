import type { Hono } from "hono";
import {
  createTemplate,
  deleteTemplate,
  getSendTemplateVersion,
  getTemplate,
  listSendTemplateVersions,
  listTemplates,
  updateTemplate,
  type References,
  type VarSchema,
} from "../../store/send-templates.js";

interface CreateBody {
  name?: unknown;
  body?: unknown;
  var_names?: unknown;
  var_schema?: unknown;
  examples?: unknown;
  scope_project_id?: unknown;
  scope_visual_id?: unknown;
}

interface UpdateBody {
  name?: unknown;
  body?: unknown;
  var_names?: unknown;
  var_schema?: unknown;
  examples?: unknown;
  scope_project_id?: unknown;
  scope_visual_id?: unknown;
}

// Accept string | null | undefined. Anything else returns ok=false so the
// route can 400. Empty string is treated as null (clear scope side).
type ScopeFieldParse =
  | { ok: true; value: string | null | undefined }
  | { ok: false };
function parseScopeField(raw: unknown): ScopeFieldParse {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "string") {
    return { ok: true, value: raw.length === 0 ? null : raw };
  }
  return { ok: false };
}

function parseVars(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") return null;
    out.push(v);
  }
  return out;
}

// Pass-through shape check for var_schema. Store runs the actual zod
// validation; here we only reject non-array (when present) so the store
// gets a well-formed input. Null = explicit clear (back to mustache).
type SchemaParse =
  | { ok: true; value: VarSchema | null | undefined }
  | { ok: false };
function parseVarSchema(raw: unknown): SchemaParse {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  return { ok: true, value: raw as VarSchema };
}

// Same pattern for examples — pass-through array check; store's zod
// runs the semantic validation (cap 3, input/output strings).
type ReferencesParse =
  | { ok: true; value: References | null | undefined }
  | { ok: false };
function parseReferencesPayload(raw: unknown): ReferencesParse {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  return { ok: true, value: raw as References };
}

export function mountSendTemplateRoutes(app: Hono): void {
  app.get("/api/send-templates", (c) => {
    // S7 P3.A — optional scope-aware filter. Empty string is treated as
    // unspecified so a stray `?project=` doesn't accidentally request a
    // null-id match. Builder views (/templates page) pass neither query
    // arg and get the full unfiltered list back.
    const project = c.req.query("project");
    const visual = c.req.query("visual");
    const hasProject = typeof project === "string" && project.length > 0;
    const hasVisual = typeof visual === "string" && visual.length > 0;
    if (!hasProject && !hasVisual) {
      return c.json(listTemplates());
    }
    return c.json(
      listTemplates({
        projectId: hasProject ? project : null,
        visualId: hasVisual ? visual : null,
      }),
    );
  });

  app.post("/api/send-templates", async (c) => {
    const body = (await c.req.json().catch(() => null)) as CreateBody | null;
    if (!body) return c.json({ error: "invalid_json" }, 400);
    if (typeof body.name !== "string" || typeof body.body !== "string") {
      return c.json({ error: "name_and_body_required" }, 400);
    }
    const vars = parseVars(body.var_names);
    if (vars === null) return c.json({ error: "var_names_must_be_string_array" }, 400);
    const schemaParse = parseVarSchema(body.var_schema);
    if (!schemaParse.ok) return c.json({ error: "var_schema_must_be_array_or_null" }, 400);
    const examplesParse = parseReferencesPayload(body.examples);
    if (!examplesParse.ok) return c.json({ error: "examples_must_be_array_or_null" }, 400);
    const projScope = parseScopeField(body.scope_project_id);
    if (!projScope.ok) return c.json({ error: "scope_project_id_must_be_string_or_null" }, 400);
    const visScope = parseScopeField(body.scope_visual_id);
    if (!visScope.ok) return c.json({ error: "scope_visual_id_must_be_string_or_null" }, 400);

    const result = createTemplate({
      name: body.name,
      body: body.body,
      var_names: vars,
      var_schema: schemaParse.value,
      examples: examplesParse.value,
      scope_project_id: projScope.value ?? null,
      scope_visual_id: visScope.value ?? null,
    });
    if (!result.ok) return c.json({ error: result.reason }, 400);
    return c.json(result.template, 201);
  });

  app.patch("/api/send-templates/:id", async (c) => {
    const id = c.req.param("id");
    const existing = getTemplate(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    // v0.9.3 Phase F polish — built-ins are editable (Owner 2026-05-18).
    // Scope on built-ins still blocked by validateScope (builtin_must_be_global).

    const body = (await c.req.json().catch(() => null)) as UpdateBody | null;
    if (!body) return c.json({ error: "invalid_json" }, 400);
    const patch: {
      name?: string;
      body?: string;
      var_names?: string[];
      var_schema?: VarSchema | null;
      examples?: References | null;
      scope_project_id?: string | null;
      scope_visual_id?: string | null;
    } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") return c.json({ error: "name_must_be_string" }, 400);
      patch.name = body.name;
    }
    if (body.body !== undefined) {
      if (typeof body.body !== "string") return c.json({ error: "body_must_be_string" }, 400);
      patch.body = body.body;
    }
    if (body.var_names !== undefined) {
      const vars = parseVars(body.var_names);
      if (vars === null) return c.json({ error: "var_names_must_be_string_array" }, 400);
      patch.var_names = vars;
    }
    if (body.var_schema !== undefined) {
      const schemaParse = parseVarSchema(body.var_schema);
      if (!schemaParse.ok) return c.json({ error: "var_schema_must_be_array_or_null" }, 400);
      // schemaParse.value here is VarSchema | null (undefined branch ruled out).
      patch.var_schema = schemaParse.value as VarSchema | null;
    }
    if (body.examples !== undefined) {
      const examplesParse = parseReferencesPayload(body.examples);
      if (!examplesParse.ok) return c.json({ error: "examples_must_be_array_or_null" }, 400);
      patch.examples = examplesParse.value as References | null;
    }
    if (body.scope_project_id !== undefined) {
      const projScope = parseScopeField(body.scope_project_id);
      if (!projScope.ok) return c.json({ error: "scope_project_id_must_be_string_or_null" }, 400);
      patch.scope_project_id = projScope.value as string | null;
    }
    if (body.scope_visual_id !== undefined) {
      const visScope = parseScopeField(body.scope_visual_id);
      if (!visScope.ok) return c.json({ error: "scope_visual_id_must_be_string_or_null" }, 400);
      patch.scope_visual_id = visScope.value as string | null;
    }

    const result = updateTemplate(id, patch);
    if (!result.ok) return c.json({ error: result.reason }, 400);
    return c.json(result.template);
  });

  // S5 P3.D — list frozen versions for the picker.
  app.get("/api/send-templates/:id/versions", (c) => {
    const id = c.req.param("id");
    if (!getTemplate(id)) return c.json({ error: "not_found" }, 404);
    const versions = listSendTemplateVersions(id);
    return c.json(versions);
  });

  // S5 P3.D / P3.E — single frozen version for picker pre-fill + diff.
  app.get("/api/send-templates/:id/versions/:num", (c) => {
    const id = c.req.param("id");
    const num = Number.parseInt(c.req.param("num"), 10);
    if (!Number.isFinite(num) || num < 1) {
      return c.json({ error: "invalid_version" }, 400);
    }
    const ver = getSendTemplateVersion(id, num);
    if (!ver) return c.json({ error: "not_found" }, 404);
    return c.json(ver);
  });

  // S7 P4.G — fork a copy of an existing template (built-in or saved).
  // The new row starts as a global user template; scope is intentionally
  // cleared so the fork is reusable across contexts. References + var schema
  // carry over as v1 of the copy.
  app.post("/api/send-templates/:id/duplicate", (c) => {
    const id = c.req.param("id");
    const src = getTemplate(id);
    if (!src) return c.json({ error: "not_found" }, 404);
    const result = createTemplate({
      name: `${src.name} (copy)`,
      body: src.body,
      var_names: [...src.var_names],
      var_schema: src.var_schema ? src.var_schema.map((v) => ({ ...v })) : null,
      examples: src.examples ? src.examples.map((e) => ({ ...e })) : null,
      scope_project_id: null,
      scope_visual_id: null,
    });
    if (!result.ok) return c.json({ error: result.reason }, 400);
    return c.json(result.template, 201);
  });

  app.delete("/api/send-templates/:id", (c) => {
    const id = c.req.param("id");
    const result = deleteTemplate(id);
    if (!result.ok) {
      return c.json({ error: result.reason }, result.reason === "not_found" ? 404 : 400);
    }
    return c.json({ ok: true });
  });
}
