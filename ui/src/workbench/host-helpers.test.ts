import { describe, expect, it } from "vitest";
import type { SendTemplate, VarSchema } from "../send-template-utils";
import {
  autoCopyEnabled,
  clipboardCommandForInbox,
  defaultsFor,
  formatWhen,
  frozenToWorkbench,
  paletteScopeFor,
  toWorkbenchTemplate,
  type FrozenVersionRow,
} from "./host-helpers";
import type { WorkbenchTemplate } from "./types";

const baseTemplate: SendTemplate = {
  id: "t1",
  name: "iterate",
  body: "iterate on {{title}}",
  var_names: ["title"],
  var_schema: null,
  examples: null,
  is_builtin: true,
  sort_order: 0,
  created_at: "2026-05-12T00:00:00Z",
  current_version_num: 1,
};

describe("toWorkbenchTemplate", () => {
  it("maps SendTemplate fields into WorkbenchTemplate shape", () => {
    const wb = toWorkbenchTemplate(baseTemplate);
    expect(wb.id).toBe("t1");
    expect(wb.name).toBe("iterate");
    expect(wb.body).toBe("iterate on {{title}}");
    expect(wb.builtin).toBe(true);
    expect(wb.versionNum).toBe(1);
    expect(wb.varSchema).toBeNull();
    expect(wb.examples).toBeNull();
  });

  it("defaults versionNum to 1 when SendTemplate omits current_version_num", () => {
    const { current_version_num: _drop, ...rest } = baseTemplate;
    const wb = toWorkbenchTemplate(rest);
    expect(wb.versionNum).toBe(1);
  });

  it("passes through var_schema and references when present", () => {
    const schema: VarSchema = [{ name: "title", type: "string", required: true }];
    const refs = [{ name: "ref1", visual_id: "vis_xyz", visual_version: null }];
    const wb = toWorkbenchTemplate({
      ...baseTemplate,
      var_schema: schema,
      examples: refs,
    });
    expect(wb.varSchema).toEqual(schema);
    expect(wb.examples).toEqual(refs);
  });
});

describe("frozenToWorkbench", () => {
  it("uses frozen body + schema + references but keeps the live id/name/builtin", () => {
    const refs = [{ name: "ref1", visual_id: "vis_pin", visual_version: 2 }];
    const frozen: FrozenVersionRow = {
      version_num: 3,
      body: "frozen body {{title}}",
      var_schema: [{ name: "title", type: "string" }],
      examples: refs,
      created_at: "2026-05-01T00:00:00Z",
    };
    const wb = frozenToWorkbench(baseTemplate, frozen);
    expect(wb.id).toBe(baseTemplate.id);
    expect(wb.name).toBe(baseTemplate.name);
    expect(wb.body).toBe("frozen body {{title}}");
    expect(wb.versionNum).toBe(3);
    expect(wb.varSchema).toEqual([{ name: "title", type: "string" }]);
    expect(wb.examples).toEqual(refs);
    expect(wb.builtin).toBe(baseTemplate.is_builtin);
  });
});

describe("defaultsFor", () => {
  it("returns defaultsFromSchema when schema is provided", () => {
    const schema: VarSchema = [
      { name: "title", type: "string", default: "Untitled" },
      { name: "tone", type: "enum", options: ["pro", "fun"] },
    ];
    const d = defaultsFor(schema, []);
    expect(d.title).toBe("Untitled");
    expect(d.tone).toBe("pro");
  });

  it("falls back to var-name list with `count`→`3` heuristic when no schema", () => {
    const d = defaultsFor(null, ["title", "count"]);
    expect(d.title).toBe("");
    expect(d.count).toBe("3");
  });

  it("empty schema + empty var names returns an empty record", () => {
    expect(defaultsFor(null, [])).toEqual({});
  });
});

describe("formatWhen", () => {
  const now = Date.parse("2026-05-12T12:00:00Z");

  it("returns 'just now' inside the first minute", () => {
    expect(formatWhen("2026-05-12T11:59:30Z", now)).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(formatWhen("2026-05-12T11:25:00Z", now)).toBe("35m");
  });

  it("returns hours for under a day", () => {
    expect(formatWhen("2026-05-12T05:00:00Z", now)).toBe("7h");
  });

  it("returns days for older timestamps", () => {
    expect(formatWhen("2026-05-09T12:00:00Z", now)).toBe("3d");
  });

  it("returns empty string for unparseable input", () => {
    expect(formatWhen("not-a-date", now)).toBe("");
  });
});

describe("paletteScopeFor (S7 P3.D)", () => {
  function tpl(overrides: Partial<WorkbenchTemplate>): WorkbenchTemplate {
    return {
      id: "t",
      name: "n",
      body: "b",
      varSchema: null,
      examples: null,
      builtin: false,
      versionNum: 1,
      scopeProjectId: null,
      scopeVisualId: null,
      ...overrides,
    };
  }

  it("returns 'builtin' for is_builtin templates regardless of scope cols", () => {
    expect(paletteScopeFor(tpl({ builtin: true })).kind).toBe("builtin");
    expect(
      paletteScopeFor(
        tpl({ builtin: true, scopeProjectId: "p1" }),
      ).kind,
    ).toBe("builtin");
  });

  it("returns 'visual' when scopeVisualId is set and not archived", () => {
    expect(paletteScopeFor(tpl({ scopeVisualId: "v1" })).kind).toBe("visual");
  });

  it("returns 'archived' when scopeVisualId is in the archived set", () => {
    const archived = new Set(["v1"]);
    expect(
      paletteScopeFor(tpl({ scopeVisualId: "v1" }), archived).kind,
    ).toBe("archived");
    // Other archived ids in the set don't bleed.
    expect(
      paletteScopeFor(tpl({ scopeVisualId: "v2" }), archived).kind,
    ).toBe("visual");
  });

  it("returns 'project' when only scopeProjectId is set", () => {
    expect(paletteScopeFor(tpl({ scopeProjectId: "p1" })).kind).toBe(
      "project",
    );
  });

  it("returns 'global' when neither scope id is set", () => {
    expect(paletteScopeFor(tpl({})).kind).toBe("global");
  });
});

describe("toWorkbenchTemplate scope passthrough (S7 P3.D)", () => {
  it("populates scopeProjectId / scopeVisualId from the server fields", () => {
    const t: SendTemplate = {
      id: "scoped",
      name: "ScopedRow",
      body: "{{x}}",
      var_names: ["x"],
      var_schema: null,
      examples: null,
      is_builtin: false,
      sort_order: 0,
      created_at: "2026-05-13T00:00:00Z",
      current_version_num: 1,
      scope_project_id: "p1",
      scope_visual_id: null,
    };
    const wb = toWorkbenchTemplate(t);
    expect(wb.scopeProjectId).toBe("p1");
    expect(wb.scopeVisualId).toBeNull();
  });

  it("defaults scope fields to null when the server omits them", () => {
    const t: SendTemplate = {
      id: "legacy",
      name: "LegacyRow",
      body: "{{x}}",
      var_names: ["x"],
      var_schema: null,
      examples: null,
      is_builtin: false,
      sort_order: 0,
      created_at: "2026-05-13T00:00:00Z",
      current_version_num: 1,
    };
    const wb = toWorkbenchTemplate(t);
    expect(wb.scopeProjectId).toBeNull();
    expect(wb.scopeVisualId).toBeNull();
  });
});

describe("warm handoff (S7 P6.A + P6.D)", () => {
  it("clipboardCommandForInbox produces `magpie read_inbox id=<id>` exactly", () => {
    expect(clipboardCommandForInbox("xyz")).toBe("magpie read_inbox id=xyz");
    expect(clipboardCommandForInbox("Abc-123_QRS")).toBe(
      "magpie read_inbox id=Abc-123_QRS",
    );
  });

  it("autoCopyEnabled defaults on when no storage / no opt-out key", () => {
    expect(autoCopyEnabled(null)).toBe(true);
    const empty = { getItem: () => null };
    expect(autoCopyEnabled(empty)).toBe(true);
  });

  it("autoCopyEnabled returns false only when key is exactly 'off'", () => {
    const off = { getItem: () => "off" };
    expect(autoCopyEnabled(off)).toBe(false);
    const other = { getItem: () => "yes" };
    expect(autoCopyEnabled(other)).toBe(true);
  });
});
