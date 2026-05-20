import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db.js";
import {
  archiveProject,
  createProject,
  findArchivedByName,
  findByName,
  listArchivedProjects,
  listProjects,
  mergeProjects,
  renameProject,
  restoreProject,
  setProjectDescription,
} from "./projects.js";
import { createVisual } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("projects store", () => {
  it("createProject + findByName roundtrip", () => {
    const p = createProject("alpha", "mockup");
    expect(p.name).toBe("alpha");
    expect(p.type).toBe("mockup");
    expect(p.archived_at).toBeNull();
    const found = findByName("alpha");
    expect(found?.id).toBe(p.id);
  });

  it("createProject is idempotent on duplicate name", () => {
    const a = createProject("alpha", "mockup");
    const b = createProject("alpha", "diagram");
    expect(b.id).toBe(a.id);
    expect(b.type).toBe("mockup");
  });

  it("listProjects orders by last_activity desc and excludes archived", () => {
    const a = createProject("alpha", "mockup");
    const b = createProject("beta", "diagram");
    createVisual({ project_id: b.id, title: "bv", type: "html", source: null });
    archiveProject(a.name);
    const rows = listProjects();
    expect(rows.map((r) => r.name)).toEqual(["beta"]);
    expect(rows[0]?.visual_count).toBe(1);
  });

  it("archiveProject + restoreProject", () => {
    createProject("alpha", "mockup");
    expect(archiveProject("alpha")).toBe(true);
    expect(findByName("alpha")).toBeNull();
    expect(findArchivedByName("alpha")?.name).toBe("alpha");
    expect(listArchivedProjects().length).toBe(1);
    expect(restoreProject("alpha")).toBe(true);
    expect(findByName("alpha")?.name).toBe("alpha");
  });

  it("archiveProject on missing project returns false", () => {
    expect(archiveProject("nope")).toBe(false);
  });

  it("renameProject succeeds and rejects conflicts", () => {
    createProject("alpha", "mockup");
    createProject("beta", "diagram");
    expect(renameProject("alpha", "alpha")).toEqual({
      ok: false,
      reason: "old_name and new_name are identical",
    });
    expect(renameProject("missing", "x")).toEqual({
      ok: false,
      reason: 'project "missing" not found',
    });
    expect(renameProject("alpha", "beta")).toEqual({
      ok: false,
      reason: 'project "beta" already exists',
    });
    expect(renameProject("alpha", "gamma")).toEqual({ ok: true });
    expect(findByName("gamma")?.name).toBe("gamma");
    expect(findByName("alpha")).toBeNull();
  });

  it("mergeProjects moves visuals + archives src", () => {
    const a = createProject("alpha", "mockup");
    const b = createProject("beta", "mockup");
    createVisual({ project_id: a.id, title: "v1", type: "html", source: null });
    createVisual({ project_id: a.id, title: "v2", type: "html", source: null });
    createVisual({ project_id: b.id, title: "v3", type: "html", source: null });
    const r = mergeProjects("alpha", "beta");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.moved).toBe(2);
      expect(r.result.src_archived).toBe(true);
    }
    expect(findByName("alpha")).toBeNull();
    expect(findByName("beta")?.id).toBe(b.id);
  });

  it("createProject persists description; setProjectDescription updates it", () => {
    const p = createProject("alpha", "mockup", "first cut of onboarding flow");
    expect(p.description).toBe("first cut of onboarding flow");
    expect(findByName("alpha")?.description).toBe("first cut of onboarding flow");
    setProjectDescription(p.id, "renamed scope");
    expect(findByName("alpha")?.description).toBe("renamed scope");
    setProjectDescription(p.id, null);
    expect(findByName("alpha")?.description).toBeNull();
  });

  it("createProject defaults description to null when not supplied", () => {
    const p = createProject("beta", "diagram");
    expect(p.description).toBeNull();
    expect(findByName("beta")?.description).toBeNull();
  });

  it("mergeProjects rejects same/missing projects", () => {
    createProject("alpha", "mockup");
    expect(mergeProjects("alpha", "alpha")).toEqual({
      ok: false,
      reason: "src and dst are the same project",
    });
    expect(mergeProjects("alpha", "ghost")).toEqual({
      ok: false,
      reason: 'destination project "ghost" not found',
    });
    expect(mergeProjects("ghost", "alpha")).toEqual({
      ok: false,
      reason: 'source project "ghost" not found',
    });
  });
});
