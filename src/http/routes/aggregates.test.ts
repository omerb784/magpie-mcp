import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import { createProject } from "../../store/projects.js";
import { attachTag, ensureTag } from "../../store/tags.js";
import {
  archiveVisual,
  createVisual,
  updateVisualMeta,
} from "../../store/visuals.js";
import { mountAggregateRoutes } from "./aggregates.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountAggregateRoutes(app);
  return app;
}

async function getJson<T>(app: Hono, path: string): Promise<T> {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("GET /api/tags", () => {
  it("returns name + color + count, sorted by count desc then name asc", async () => {
    const p = createProject("p", "mockup");
    const v1 = createVisual({ project_id: p.id, title: "a", type: "html", source: null });
    const v2 = createVisual({ project_id: p.id, title: "b", type: "html", source: null });
    const v3 = createVisual({ project_id: p.id, title: "c", type: "html", source: null });
    const wip = ensureTag("wip");
    const dash = ensureTag("dashboard");
    attachTag(v1.id, wip.id);
    attachTag(v2.id, wip.id);
    attachTag(v3.id, dash.id);

    const rows = await getJson<Array<{ name: string; color: string | null; count: number }>>(
      buildApp(),
      "/api/tags"
    );
    const populated = rows.filter((r) => r.count > 0);
    expect(populated.map((r) => r.name)).toEqual(["wip", "dashboard"]);
    expect(populated[0].count).toBe(2);
    expect(populated[1].count).toBe(1);
  });

  it("excludes archived visuals from count but keeps the tag with count 0", async () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "a", type: "html", source: null });
    const wip = ensureTag("wip");
    attachTag(v.id, wip.id);
    archiveVisual(v.id);
    const rows = await getJson<Array<{ name: string; count: number }>>(buildApp(), "/api/tags");
    const wipRow = rows.find((r) => r.name === "wip");
    expect(wipRow?.count).toBe(0);
  });

  it("includes orphan tags with count 0 (G-9: lets sidebar surface them)", async () => {
    ensureTag("wip");
    const rows = await getJson<Array<{ name: string; count: number }>>(buildApp(), "/api/tags");
    const wipRow = rows.find((r) => r.name === "wip");
    expect(wipRow).toEqual({ name: "wip", color: expect.any(String), count: 0 });
  });
});

describe("POST /api/tags", () => {
  async function postTag(app: Hono, body: unknown): Promise<Response> {
    return app.fetch(
      new Request("http://localhost/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  it("creates a tag (201) + appears in subsequent GET", async () => {
    const app = buildApp();
    const res = await postTag(app, { name: "approved" });
    expect(res.status).toBe(201);
    const tag = (await res.json()) as { name: string };
    expect(tag.name).toBe("approved");
    const rows = await getJson<Array<{ name: string }>>(app, "/api/tags");
    expect(rows.find((r) => r.name === "approved")).toBeTruthy();
  });

  it("re-POST with same name is idempotent (returns existing tag)", async () => {
    const app = buildApp();
    const a = (await (await postTag(app, { name: "wip" })).json()) as { id: string };
    const b = (await (await postTag(app, { name: "wip" })).json()) as { id: string };
    expect(a.id).toBe(b.id);
  });

  it("400 on missing name", async () => {
    const res = await postTag(buildApp(), {});
    expect(res.status).toBe(400);
  });

  it("400 on invalid name (special chars)", async () => {
    const res = await postTag(buildApp(), { name: "bad name!" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tags (additional)", () => {

  it("preserves seeded color when present", async () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "a", type: "html", source: null });
    const dash = ensureTag("dashboard");
    attachTag(v.id, dash.id);
    const rows = await getJson<Array<{ name: string; color: string | null }>>(
      buildApp(),
      "/api/tags"
    );
    const dashboardRow = rows.find((r) => r.name === "dashboard");
    expect(dashboardRow?.color).toBe("#d97757");
  });
});

describe("GET /api/library-counts", () => {
  it("returns all/starred/archived totals", async () => {
    const p = createProject("p", "mockup");
    const a = createVisual({ project_id: p.id, title: "a", type: "html", source: null });
    const b = createVisual({ project_id: p.id, title: "b", type: "html", source: null });
    const c = createVisual({ project_id: p.id, title: "c", type: "html", source: null });
    updateVisualMeta({ visual_id: a.id, starred: true });
    archiveVisual(c.id);
    expect(b.id).toBeDefined();

    const counts = await getJson<{ all: number; starred: number; archived: number }>(
      buildApp(),
      "/api/library-counts"
    );
    expect(counts).toEqual({ all: 2, starred: 1, archived: 1 });
  });

  it("returns zeros on empty DB", async () => {
    const counts = await getJson<{ all: number; starred: number; archived: number }>(
      buildApp(),
      "/api/library-counts"
    );
    expect(counts).toEqual({ all: 0, starred: 0, archived: 0 });
  });
});
