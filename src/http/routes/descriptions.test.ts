import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import { createProject, findByName } from "../../store/projects.js";
import { createVisual, getVisual } from "../../store/visuals.js";
import { mountProjectRoutes } from "./projects.js";
import { mountVisualRoutes } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountProjectRoutes(app);
  mountVisualRoutes(app);
  return app;
}

async function patch(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("PATCH /api/projects/:name description", () => {
  it("accepts description-only patch and persists", async () => {
    const p = createProject("alpha", "mockup");
    const res = await patch(buildApp(), `/api/projects/${p.name}`, {
      description: "onboarding flows",
    });
    expect(res.status).toBe(200);
    expect(findByName("alpha")?.description).toBe("onboarding flows");
  });

  it("accepts rename + description in one patch", async () => {
    createProject("alpha", "mockup");
    const res = await patch(buildApp(), "/api/projects/alpha", {
      name: "alpha2",
      description: "v2 of onboarding",
    });
    expect(res.status).toBe(200);
    expect(findByName("alpha")).toBeNull();
    expect(findByName("alpha2")?.description).toBe("v2 of onboarding");
  });

  it("accepts description: null to clear", async () => {
    const p = createProject("alpha", "mockup", "spec");
    const res = await patch(buildApp(), `/api/projects/${p.name}`, {
      description: null,
    });
    expect(res.status).toBe(200);
    expect(findByName("alpha")?.description).toBeNull();
  });

  it("rejects oversized description", async () => {
    createProject("alpha", "mockup");
    const big = "x".repeat(2001);
    const res = await patch(buildApp(), "/api/projects/alpha", { description: big });
    expect(res.status).toBe(400);
  });

  it("rejects empty body", async () => {
    createProject("alpha", "mockup");
    const res = await patch(buildApp(), "/api/projects/alpha", {});
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/visuals/:id description", () => {
  it("accepts description-only patch and persists", async () => {
    const p = createProject("alpha", "mockup");
    const v = createVisual({ project_id: p.id, title: "Hero", type: "html", source: null });
    const res = await patch(buildApp(), `/api/visuals/${v.id}`, {
      description: "checkout funnel revamp",
    });
    expect(res.status).toBe(200);
    expect(getVisual(v.id)?.description).toBe("checkout funnel revamp");
  });

  it("accepts description: null to clear", async () => {
    const p = createProject("alpha", "mockup");
    const v = createVisual({
      project_id: p.id,
      title: "Hero",
      type: "html",
      source: null,
      description: "x",
    });
    const res = await patch(buildApp(), `/api/visuals/${v.id}`, { description: null });
    expect(res.status).toBe(200);
    expect(getVisual(v.id)?.description).toBeNull();
  });

  it("rejects oversized description", async () => {
    const p = createProject("alpha", "mockup");
    const v = createVisual({ project_id: p.id, title: "Hero", type: "html", source: null });
    const big = "x".repeat(2001);
    const res = await patch(buildApp(), `/api/visuals/${v.id}`, { description: big });
    expect(res.status).toBe(400);
  });
});
