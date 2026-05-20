import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import type { SendTemplate } from "../../store/send-templates.js";
import { mountSendTemplateRoutes } from "./send-templates.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountSendTemplateRoutes(app);
  return app;
}

async function jsonReq(
  app: Hono,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.fetch(new Request(`http://localhost${path}`, init));
}

describe("send-template routes", () => {
  it("GET lists 8 built-ins on first run (S5 trio + S7 quintet)", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates", "GET");
    expect(res.status).toBe(200);
    const list = (await res.json()) as SendTemplate[];
    expect(list).toHaveLength(10);
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

  it("POST creates a user template (201) + GET surfaces it below builtins", async () => {
    const app = buildApp();
    const create = await jsonReq(app, "/api/send-templates", "POST", {
      name: "Tighten copy",
      body: "Tighten {{id}} — make it {{tone}}.",
      var_names: ["tone"],
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as SendTemplate;
    expect(created.is_builtin).toBe(false);

    const list = (await (await jsonReq(app, "/api/send-templates", "GET")).json()) as SendTemplate[];
    expect(list).toHaveLength(11);
    expect(list[10].id).toBe(created.id);
  });

  it("POST 400 on > 5 vars", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates", "POST", {
      name: "T",
      body: "b",
      var_names: ["a", "b", "c", "d", "e", "f"],
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("var_count_exceeded");
  });

  it("POST 400 on invalid var name", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates", "POST", {
      name: "T",
      body: "b",
      var_names: ["1bad"],
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("var_name_invalid");
  });

  it("POST 400 on missing name", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates", "POST", {
      body: "b",
      var_names: [],
    });
    expect(res.status).toBe(400);
  });

  it("PATCH updates user template", async () => {
    const app = buildApp();
    const create = await (await jsonReq(app, "/api/send-templates", "POST", {
      name: "T",
      body: "b",
      var_names: [],
    })).json() as SendTemplate;

    const patch = await jsonReq(app, `/api/send-templates/${create.id}`, "PATCH", {
      name: "T2",
      body: "{{x}}",
      var_names: ["x"],
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as SendTemplate;
    expect(updated.name).toBe("T2");
    expect(updated.var_names).toEqual(["x"]);
  });

  it("PATCH succeeds on built-in (Phase F polish — editable in place)", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates/builtin-iterate", "PATCH", {
      name: "Iterate (edited)",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as SendTemplate;
    expect(updated.name).toBe("Iterate (edited)");
    expect(updated.is_builtin).toBe(true);
  });

  it("PATCH 400 when setting scope on built-in (builtins always global)", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates/builtin-iterate", "PATCH", {
      scope_project_id: "any-proj-id",
    });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("builtin_must_be_global");
  });

  it("PATCH 404 on missing id", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates/does-not-exist", "PATCH", {
      name: "x",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes user template", async () => {
    const app = buildApp();
    const create = await (await jsonReq(app, "/api/send-templates", "POST", {
      name: "T",
      body: "b",
      var_names: [],
    })).json() as SendTemplate;

    const del = await jsonReq(app, `/api/send-templates/${create.id}`, "DELETE");
    expect(del.status).toBe(200);

    const list = (await (await jsonReq(app, "/api/send-templates", "GET")).json()) as SendTemplate[];
    expect(list).toHaveLength(10);
  });

  it("DELETE 400 on built-in", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates/builtin-iterate", "DELETE");
    expect(res.status).toBe(400);
  });

  it("DELETE 404 on missing id", async () => {
    const res = await jsonReq(buildApp(), "/api/send-templates/does-not-exist", "DELETE");
    expect(res.status).toBe(404);
  });

  // S7 P3.E — scope-aware filter integration.
  describe("scope filter (S7 P3.E)", () => {
    it("GET with no context returns the full unfiltered list", async () => {
      const app = buildApp();
      const r = await jsonReq(app, "/api/send-templates", "GET");
      const list = (await r.json()) as SendTemplate[];
      expect(list.length).toBe(10);
    });

    it("GET ?project=X narrows out-of-scope user rows but keeps builtins", async () => {
      // Need a real project — easiest path: POST a scoped row via the
      // store directly, since the route returns the same list shape.
      const { closeDb: closeDb2 } = await import("../../store/db.js");
      closeDb2();
      const { createProject } = await import("../../store/projects.js");
      const { createTemplate } = await import("../../store/send-templates.js");
      const p1 = createProject("ssp1", "mixed");
      const p2 = createProject("ssp2", "mixed");
      createTemplate({
        name: "ProjP1Only",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: p1.id,
      });
      createTemplate({
        name: "Global1",
        body: "{{x}}",
        var_names: ["x"],
      });

      const app = buildApp();
      const r = await jsonReq(app, `/api/send-templates?project=${p2.id}`, "GET");
      const list = (await r.json()) as SendTemplate[];
      const names = list.map((t) => t.name);
      // p1-scoped row should not surface for p2 context.
      expect(names).not.toContain("ProjP1Only");
      // global user row + builtins should remain.
      expect(names).toContain("Global1");
      expect(list.filter((t) => t.is_builtin).length).toBe(10);
    });

    it("GET ?visual=X surfaces visual-scoped rows + scope-nearest order", async () => {
      const { closeDb: closeDb2 } = await import("../../store/db.js");
      closeDb2();
      const { createProject } = await import("../../store/projects.js");
      const { createVisual } = await import("../../store/visuals.js");
      const { createTemplate } = await import("../../store/send-templates.js");
      const p = createProject("svp", "mixed");
      const v = createVisual({
        project_id: p.id,
        title: "Login",
        type: "html",
        source: null,
      });
      createTemplate({
        name: "VisRow",
        body: "{{x}}",
        var_names: ["x"],
        scope_visual_id: v.id,
      });
      createTemplate({
        name: "ProjRow",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: p.id,
      });
      createTemplate({
        name: "GlobalRow",
        body: "{{x}}",
        var_names: ["x"],
      });

      const app = buildApp();
      const r = await jsonReq(
        app,
        `/api/send-templates?project=${p.id}&visual=${v.id}`,
        "GET",
      );
      const list = (await r.json()) as SendTemplate[];
      const userOrder = list.filter((t) => !t.is_builtin).map((t) => t.name);
      expect(userOrder).toEqual(["VisRow", "ProjRow", "GlobalRow"]);
    });

    it("POST 400 on non-string non-null scope_project_id", async () => {
      const r = await jsonReq(buildApp(), "/api/send-templates", "POST", {
        name: "Bad",
        body: "{{x}}",
        var_names: ["x"],
        scope_project_id: 42,
      });
      expect(r.status).toBe(400);
      const err = (await r.json()) as { error: string };
      expect(err.error).toBe("scope_project_id_must_be_string_or_null");
    });
  });

  // S7 P4.G — duplicate endpoint.
  describe("duplicate (S7 P4.G)", () => {
    it("POST /api/send-templates/builtin-iterate/duplicate forks builtin into a saved row", async () => {
      const app = buildApp();
      const r = await jsonReq(
        app,
        "/api/send-templates/builtin-iterate/duplicate",
        "POST",
      );
      expect(r.status).toBe(201);
      const created = (await r.json()) as SendTemplate;
      expect(created.is_builtin).toBe(false);
      expect(created.name).toBe("Iterate (copy)");
      expect(created.id).not.toBe("builtin-iterate");
      expect(created.var_names).toEqual(["change"]);
      // Scope cleared to global per locked default.
      expect(created.scope_project_id ?? null).toBeNull();
      expect(created.scope_visual_id ?? null).toBeNull();
    });

    it("POST /api/send-templates/:id/duplicate 404 on missing id", async () => {
      const app = buildApp();
      const r = await jsonReq(
        app,
        "/api/send-templates/does-not-exist/duplicate",
        "POST",
      );
      expect(r.status).toBe(404);
    });
  });
});
