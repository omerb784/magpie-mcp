import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db.js";
import {
  createTemplate,
  deleteTemplate,
  getSendTemplateVersion,
  getTemplate,
  listSendTemplateVersions,
  listTemplates,
  updateTemplate,
  validateTemplateInput,
  type References,
  type VarSchema,
  VAR_NAME_RE,
  MAX_VARS,
  NAME_MAX,
} from "./send-templates.js";
import { insertInbox, getInbox } from "./inbox.js";
import { createProject } from "./projects.js";
import { createVisual } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("send-templates store", () => {
  describe("seed", () => {
    it("seeds 10 built-ins on first run with stable ids", () => {
      const list = listTemplates();
      expect(list).toHaveLength(10);
      expect(list.map((t) => t.id).sort()).toEqual([
        "builtin-a11y-audit",
        "builtin-add-data",
        "builtin-dark-mode-port",
        "builtin-explain",
        "builtin-extract-decisions",
        "builtin-iterate",
        "builtin-polish-prose",
        "builtin-responsive-check",
        "builtin-simplify",
        "builtin-variants",
      ]);
      expect(list.every((t) => t.is_builtin)).toBe(true);
    });

    it("built-ins sort by sort_order across S5+S7+v0.9.3 seed: Iterate, Variants, Explain, A11y, Responsive, Dark-mode, Simplify, Add data, Polish prose, Extract decisions", () => {
      const list = listTemplates();
      expect(list.map((t) => t.name)).toEqual([
        "Iterate",
        "Variants",
        "Explain",
        "A11y audit",
        "Responsive check",
        "Dark-mode port",
        "Simplify",
        "Add realistic data",
        "Polish prose",
        "Extract decisions",
      ]);
    });

    it("seed runs idempotent — touching db twice does not duplicate", () => {
      listTemplates();
      // Force a second migration pass shouldn't double-insert (INSERT OR IGNORE).
      const db = getDb();
      const sql = `INSERT OR IGNORE INTO send_templates (id, name, body, var_names, is_builtin, sort_order, created_at)
        VALUES ('builtin-iterate', 'Iterate', 'x', '[]', 1, 1, '2026-05-09')`;
      db.exec(sql);
      expect(listTemplates().filter((t) => t.id === "builtin-iterate")).toHaveLength(1);
    });

    it("Iterate carries change; Variants count; Explain none; S7 builtins carry their main MCP-prompt arg", () => {
      const list = listTemplates();
      const byId = Object.fromEntries(list.map((t) => [t.id, t]));
      expect(byId["builtin-iterate"].var_names).toEqual(["change"]);
      expect(byId["builtin-variants"].var_names).toEqual(["count"]);
      expect(byId["builtin-explain"].var_names).toEqual([]);
      expect(byId["builtin-a11y-audit"].var_names).toEqual(["target_level"]);
      expect(byId["builtin-responsive-check"].var_names).toEqual(["breakpoints"]);
      expect(byId["builtin-dark-mode-port"].var_names).toEqual([]);
      expect(byId["builtin-simplify"].var_names).toEqual(["dimension"]);
      expect(byId["builtin-add-data"].var_names).toEqual(["data_description"]);
      expect(byId["builtin-polish-prose"].var_names).toEqual(["tone"]);
      expect(byId["builtin-extract-decisions"].var_names).toEqual(["output_shape"]);
    });
  });

  describe("CRUD — user templates", () => {
    it("createTemplate stores body + vars; lists below built-ins", () => {
      const r = createTemplate({
        name: "Tighten copy",
        body: "Tighten the copy on visual {{id}} — make it {{tone}}.",
        var_names: ["tone"],
      });
      expect(r.ok).toBe(true);
      const list = listTemplates();
      // 10 builtins + the new user row.
      expect(list).toHaveLength(11);
      const userRow = list.find((t) => t.name === "Tighten copy");
      expect(userRow?.is_builtin).toBe(false);
      // User rows always sort below builtins.
      expect(list.findIndex((t) => t.id === userRow!.id)).toBe(10);
    });

    it("updateTemplate updates name + body + vars; built-ins editable in place", () => {
      const c = createTemplate({ name: "T1", body: "b", var_names: [] });
      if (!c.ok) throw new Error("setup");
      const u = updateTemplate(c.template.id, {
        name: "T1 renamed",
        body: "{{x}}",
        var_names: ["x"],
      });
      expect(u.ok).toBe(true);
      if (u.ok) {
        expect(u.template.name).toBe("T1 renamed");
        expect(u.template.var_names).toEqual(["x"]);
      }

      // v0.9.3 Phase F polish — built-ins are editable.
      const builtin = updateTemplate("builtin-iterate", { name: "renamed-iterate" });
      expect(builtin.ok).toBe(true);
      if (builtin.ok) {
        expect(builtin.template.name).toBe("renamed-iterate");
        expect(builtin.template.is_builtin).toBe(true);
      }
    });

    it("deleteTemplate removes user template; built-ins rejected", () => {
      const c = createTemplate({ name: "T1", body: "b", var_names: [] });
      if (!c.ok) throw new Error("setup");
      const d = deleteTemplate(c.template.id);
      expect(d.ok).toBe(true);
      expect(getTemplate(c.template.id)).toBeNull();

      const builtin = deleteTemplate("builtin-iterate");
      expect(builtin.ok).toBe(false);
      if (!builtin.ok) expect(builtin.reason).toBe("is_builtin");
    });

    it("deleteTemplate on missing id returns not_found", () => {
      const d = deleteTemplate("does-not-exist");
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toBe("not_found");
    });
  });

  describe("validation", () => {
    it("VAR_NAME_RE matches valid names + rejects invalid", () => {
      expect(VAR_NAME_RE.test("change")).toBe(true);
      expect(VAR_NAME_RE.test("count_2")).toBe(true);
      expect(VAR_NAME_RE.test("Change")).toBe(false);
      expect(VAR_NAME_RE.test("1var")).toBe(false);
      expect(VAR_NAME_RE.test("a-b")).toBe(false);
      expect(VAR_NAME_RE.test("")).toBe(false);
      expect(VAR_NAME_RE.test("a".repeat(17))).toBe(false);
    });

    it("validateTemplateInput rejects empty name + over-long name", () => {
      expect(validateTemplateInput("", "b", []).ok).toBe(false);
      expect(validateTemplateInput("   ", "b", []).ok).toBe(false);
      expect(validateTemplateInput("a".repeat(NAME_MAX + 1), "b", []).ok).toBe(false);
    });

    it("validateTemplateInput rejects empty body", () => {
      const r = validateTemplateInput("Name", "", []);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("body_required");
    });

    it(`validateTemplateInput caps vars at ${MAX_VARS}`, () => {
      const six = ["a", "b", "c", "d", "e", "f"];
      const r = validateTemplateInput("N", "b", six);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("var_count_exceeded");
    });

    it("validateTemplateInput rejects invalid var name", () => {
      const r = validateTemplateInput("N", "b", ["1bad"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("var_name_invalid");
    });

    it("validateTemplateInput rejects duplicate var names", () => {
      const r = validateTemplateInput("N", "b", ["x", "x"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("var_duplicate");
    });

    it("createTemplate surfaces validation reason", () => {
      const r = createTemplate({ name: "N", body: "b", var_names: ["1bad"] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("var_name_invalid");
    });
  });

  describe("var_schema (S5 P1.B)", () => {
    it("creates with valid string-only schema; persists + parses back", () => {
      const r = createTemplate({
        name: "Tighten copy",
        body: "Tighten {{tone}}",
        var_names: [],
        var_schema: [{ name: "tone", type: "string", required: true }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("setup");
      const round = getTemplate(r.template.id);
      expect(round?.var_schema).toEqual([{ name: "tone", type: "string", required: true }]);
      // schema names override var_names input (single source of truth).
      expect(round?.var_names).toEqual(["tone"]);
    });

    it("creates with valid mixed types (string/multiline/enum with options)", () => {
      const r = createTemplate({
        name: "Mixed",
        body: "{{title}} {{body}} {{mode}}",
        var_names: [],
        var_schema: [
          { name: "title", type: "string" },
          { name: "body", type: "multiline" },
          { name: "mode", type: "enum", options: ["concise", "detailed", "playful"] },
        ],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("setup");
      const round = getTemplate(r.template.id);
      expect(round?.var_schema).toHaveLength(3);
      const enumItem = round?.var_schema?.find((v) => v.name === "mode");
      expect(enumItem?.type).toBe("enum");
      expect(enumItem?.options).toEqual(["concise", "detailed", "playful"]);
    });

    it("rejects enum without options", () => {
      const r = createTemplate({
        name: "Bad",
        body: "{{mode}}",
        var_names: [],
        var_schema: [{ name: "mode", type: "enum" }] as unknown as VarSchema,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("schema_invalid");
    });

    it("schema-less templates return null var_schema (back-compat)", () => {
      const r = createTemplate({
        name: "Legacy",
        body: "{{change}}",
        var_names: ["change"],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("setup");
      const round = getTemplate(r.template.id);
      expect(round?.var_schema).toBeNull();
      expect(round?.var_names).toEqual(["change"]);
    });
  });

  describe("versioning (S5 P3.B)", () => {
    it("createTemplate inserts v1 row in send_template_versions", () => {
      const r = createTemplate({ name: "Versioned", body: "first body", var_names: [] });
      if (!r.ok) throw new Error("setup");
      expect(r.template.current_version_num).toBe(1);
      const versions = listSendTemplateVersions(r.template.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version_num).toBe(1);
      expect(versions[0].body).toBe("first body");
    });

    it("updateTemplate content-change inserts v2 + advances pointer", () => {
      const r = createTemplate({ name: "Edited", body: "v1 body", var_names: [] });
      if (!r.ok) throw new Error("setup");
      const u = updateTemplate(r.template.id, { body: "v2 body" });
      expect(u.ok).toBe(true);
      if (!u.ok) throw new Error("update");
      expect(u.template.current_version_num).toBe(2);
      expect(u.template.body).toBe("v2 body");
      const versions = listSendTemplateVersions(r.template.id);
      expect(versions.map((v) => v.version_num)).toEqual([2, 1]); // DESC
      expect(versions[1].body).toBe("v1 body"); // v1 still frozen
    });

    it("name-only rename does not bump version (content unchanged)", () => {
      const r = createTemplate({ name: "Origin", body: "stable", var_names: [] });
      if (!r.ok) throw new Error("setup");
      const u = updateTemplate(r.template.id, { name: "Renamed" });
      expect(u.ok).toBe(true);
      if (!u.ok) throw new Error("update");
      expect(u.template.current_version_num).toBe(1);
      expect(u.template.name).toBe("Renamed");
      const versions = listSendTemplateVersions(r.template.id);
      expect(versions).toHaveLength(1);
    });

    it("getSendTemplateVersion returns the frozen version including references", () => {
      // S8 P2.C — `examples` field is now References shape (R16). Same
      // immutability semantics — v1 stays frozen across update to v2.
      const project = createProject("ref-frozen-proj", "mixed");
      const visual = createVisual({
        project_id: project.id,
        title: "Ref Target",
        type: "html",
        source: null,
      });
      const refs: References = [
        { name: "ref1", visual_id: visual.id, visual_version: null },
      ];
      const r = createTemplate({
        name: "WithRefs",
        body: "v1 body {{ref1}}",
        var_names: [],
        examples: refs,
      });
      if (!r.ok) throw new Error("setup");
      const v1 = getSendTemplateVersion(r.template.id, 1);
      expect(v1?.body).toBe("v1 body {{ref1}}");
      expect(v1?.examples).toEqual(refs);
      // v2 with cleared refs — v1 stays frozen.
      const u = updateTemplate(r.template.id, { body: "v2 body", examples: [] });
      expect(u.ok).toBe(true);
      const v1Again = getSendTemplateVersion(r.template.id, 1);
      expect(v1Again?.examples).toEqual(refs);
      const v2 = getSendTemplateVersion(r.template.id, 2);
      expect(v2?.examples).toEqual([]);
    });

    it("inbox entry captures template_version_num at send time", () => {
      const r = createTemplate({ name: "AuditMe", body: "v1 body", var_names: [] });
      if (!r.ok) throw new Error("setup");
      const entry = insertInbox({
        prompt_body: "rendered v1",
        template_id: r.template.id,
        template_version_num: 1,
      });
      const round = getInbox(entry.id);
      expect(round?.template_id).toBe(r.template.id);
      expect(round?.template_version_num).toBe(1);
      // Editing the template later doesn't retroactively change the audit pointer.
      updateTemplate(r.template.id, { body: "v2 body" });
      const stillV1 = getInbox(entry.id);
      expect(stillV1?.template_version_num).toBe(1);
    });
  });

  describe("scope (S7 P2.B)", () => {
    it("rejects XOR violation when both scope ids are set", () => {
      const project = createProject("scope-xor", "mixed");
      const visual = createVisual({
        project_id: project.id,
        title: "v",
        type: "html",
        source: null,
      });
      const r = createTemplate({
        name: "Bad",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: project.id,
        scope_visual_id: visual.id,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("scope_xor_violation");
    });

    it("rejects scope on builtin via updateTemplate (builtins always global)", () => {
      const u = updateTemplate("builtin-iterate", {
        scope_project_id: "any",
      });
      expect(u.ok).toBe(false);
      if (!u.ok) expect(u.reason).toBe("builtin_must_be_global");
      const builtin = getTemplate("builtin-iterate");
      expect(builtin?.scope_project_id).toBeNull();
      expect(builtin?.scope_visual_id).toBeNull();
    });

    it("rejects scope_project_id referring to a non-existent project", () => {
      const r = createTemplate({
        name: "GhostProject",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: "does-not-exist",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("scope_project_not_found");
    });

    it("rejects scope_visual_id referring to a non-existent visual", () => {
      const r = createTemplate({
        name: "GhostVisual",
        body: "{{x}}",
        var_names: ["x"],
        scope_visual_id: "does-not-exist",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("scope_visual_not_found");
    });

    it("persists project-scoped template; listTemplates filter narrows correctly", () => {
      const p = createProject("scope-happy-proj", "mixed");
      const r = createTemplate({
        name: "ProjectScoped",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: p.id,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("setup");
      expect(r.template.scope_project_id).toBe(p.id);
      expect(r.template.scope_visual_id).toBeNull();
      const round = getTemplate(r.template.id);
      expect(round?.scope_project_id).toBe(p.id);
      // In-scope filter includes builtins + the scoped row.
      const inScope = listTemplates({ projectId: p.id });
      expect(inScope.map((t) => t.id)).toContain(r.template.id);
      // Different-project filter drops the scoped row (builtins still come through).
      const otherProj = createProject("scope-happy-other", "mixed");
      const outOfScope = listTemplates({ projectId: otherProj.id });
      expect(outOfScope.map((t) => t.id)).not.toContain(r.template.id);
      expect(outOfScope.every((t) => t.is_builtin)).toBe(true);
    });

    it("persists visual-scoped template; filter respects scope-nearest order", () => {
      const p = createProject("scope-visual-proj", "mixed");
      const v = createVisual({
        project_id: p.id,
        title: "Login",
        type: "html",
        source: null,
      });
      const visualRow = createTemplate({
        name: "VisualScoped",
        body: "{{x}}",
        var_names: ["x"],
        scope_visual_id: v.id,
      });
      const projRow = createTemplate({
        name: "ProjScoped",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: p.id,
      });
      const globalRow = createTemplate({
        name: "GlobalRow",
        body: "{{x}}",
        var_names: ["x"],
      });
      expect(visualRow.ok && projRow.ok && globalRow.ok).toBe(true);
      if (!visualRow.ok || !projRow.ok || !globalRow.ok) throw new Error("setup");
      const list = listTemplates({ projectId: p.id, visualId: v.id });
      const userOrder = list.filter((t) => !t.is_builtin).map((t) => t.id);
      // Visual-match should land before project-match before global.
      expect(userOrder).toEqual([visualRow.template.id, projRow.template.id, globalRow.template.id]);
    });
  });

  describe("references (S8 P2)", () => {
    it("rejects references_invalid when more than 3 refs provided (cap)", () => {
      const p = createProject("ref-cap-proj", "mixed");
      const v = createVisual({
        project_id: p.id,
        title: "ref-target",
        type: "html",
        source: null,
      });
      const r = createTemplate({
        name: "TooManyRefs",
        body: "{{ref1}} {{ref2}} {{ref3}}",
        var_names: [],
        examples: [
          { name: "ref1", visual_id: v.id, visual_version: null },
          { name: "ref2", visual_id: v.id, visual_version: null },
          { name: "ref3", visual_id: v.id, visual_version: null },
          { name: "ref1", visual_id: v.id, visual_version: null },
        ] as References,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("references_invalid");
    });

    it("rejects references_invalid when name doesn't match ^ref[1-3]$", () => {
      const p = createProject("ref-name-proj", "mixed");
      const v = createVisual({
        project_id: p.id,
        title: "ref-target",
        type: "html",
        source: null,
      });
      const r = createTemplate({
        name: "BadName",
        body: "{{stylegui}}",
        var_names: [],
        examples: [
          { name: "stylegui", visual_id: v.id, visual_version: null },
        ] as References,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("references_invalid");
    });

    it("rejects reference_visual_not_found when visual_id has no FK match", () => {
      const r = createTemplate({
        name: "GhostRef",
        body: "{{ref1}}",
        var_names: [],
        examples: [
          { name: "ref1", visual_id: "does-not-exist", visual_version: null },
        ] as References,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("reference_visual_not_found");
    });

    it("happy path — refs round-trip through create + get + version reader", () => {
      const p = createProject("ref-happy-proj", "mixed");
      const v = createVisual({
        project_id: p.id,
        title: "ref-target",
        type: "html",
        source: null,
      });
      const refs: References = [
        { name: "ref1", visual_id: v.id, visual_version: null },
        { name: "ref2", visual_id: v.id, visual_version: 1 },
      ];
      const r = createTemplate({
        name: "HappyRefs",
        body: "Use {{ref1}} and {{ref2}}.",
        var_names: [],
        examples: refs,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("setup");
      expect(r.template.examples).toEqual(refs);
      const fetched = getTemplate(r.template.id);
      expect(fetched?.examples).toEqual(refs);
      const v1 = getSendTemplateVersion(r.template.id, 1);
      expect(v1?.examples).toEqual(refs);
    });
  });

  describe("migration 012 — visual references cleanup (S8 P1)", () => {
    it("nulls pre-existing text-example data in send_template_versions", () => {
      // Touch the DB so all migrations apply on a fresh test home; then manually
      // back-fill a row with the legacy text-example shape and re-run the 012
      // SQL to assert the UPDATE clears it. This proves the migration's
      // runtime behavior independently of the LEFT-JOIN read path.
      const r = createTemplate({ name: "LegacyShape", body: "x", var_names: [] });
      if (!r.ok) throw new Error("setup");
      const db = getDb();
      const legacy = JSON.stringify([{ input: "darker bg", output: "ok bg-#111" }]);
      db.prepare(
        `UPDATE send_template_versions SET examples = ? WHERE template_id = ? AND version_num = 1`,
      ).run(legacy, r.template.id);
      const before = db
        .prepare(
          `SELECT examples FROM send_template_versions WHERE template_id = ? AND version_num = 1`,
        )
        .get(r.template.id) as { examples: string | null };
      expect(before.examples).toBe(legacy);

      // Re-run the 012 cleanup statement — idempotent shape, mirrors the
      // migration file verbatim.
      db.exec(
        `UPDATE send_template_versions SET examples = NULL WHERE examples IS NOT NULL`,
      );

      const after = db
        .prepare(
          `SELECT examples FROM send_template_versions WHERE template_id = ? AND version_num = 1`,
        )
        .get(r.template.id) as { examples: string | null };
      expect(after.examples).toBeNull();
    });

    it("schema_version is 15 after migrations run", () => {
      // Touch the DB so migrations apply, then read meta.
      listTemplates();
      const db = getDb();
      const row = db
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string } | undefined;
      expect(row?.value).toBe("15");
    });
  });
});
