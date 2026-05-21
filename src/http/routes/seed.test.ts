import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { mountSeedRoutes } from "./seed.js";
import { closeDb } from "../../store/db.js";
import { createProject, findByName } from "../../store/projects.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountSeedRoutes(app);
  return app;
}

describe("POST /api/seed/load-example", () => {
  it("seeds 8 visuals in a fresh atlas project", async () => {
    const app = buildApp();
    const res = await app.request("/api/seed/load-example", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: boolean;
      projectId: string;
      visualIds: string[];
    };
    expect(body.created).toBe(true);
    expect(body.projectId).toBeTruthy();
    expect(Array.isArray(body.visualIds)).toBe(true);
    expect(body.visualIds.length).toBe(8);

    const project = findByName("atlas");
    expect(project).not.toBeNull();
    expect(project?.id).toBe(body.projectId);
  });

  it("returns 409 with existing:true when atlas already exists", async () => {
    const pre = createProject("atlas", "mixed");
    const app = buildApp();
    const res = await app.request("/api/seed/load-example", { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      existing: boolean;
      projectId: string;
      msg: string;
    };
    expect(body.existing).toBe(true);
    expect(body.projectId).toBe(pre.id);
    expect(body.msg).toMatch(/already loaded/i);
  });
});
