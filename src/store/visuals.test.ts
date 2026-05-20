import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db.js";
import { createProject } from "./projects.js";
import { ensureTag, attachTag } from "./tags.js";
import {
  archiveVisual,
  bumpCurrentVersion,
  createVisual,
  getVisual,
  listAllVisuals,
  listArchivedVisualsForProject,
  listStarred,
  listVisualsForProject,
  restoreVisual,
  searchVisuals,
  setVisualDescription,
  updateVisualMeta,
} from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("visuals store", () => {
  it("createVisual + getVisual roundtrip", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "Hi", type: "html", source: "claude" });
    expect(v.current_ver).toBe(1);
    expect(v.starred).toBe(0);
    const got = getVisual(v.id);
    expect(got?.title).toBe("Hi");
    expect(got?.source).toBe("claude");
  });

  it("getVisual returns null for missing id", () => {
    expect(getVisual("missing")).toBeNull();
  });

  it("updateVisualMeta sets title + starred", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "old", type: "html", source: null });
    updateVisualMeta({ visual_id: v.id, title: "new", starred: true });
    const after = getVisual(v.id)!;
    expect(after.title).toBe("new");
    expect(after.starred).toBe(1);
    updateVisualMeta({ visual_id: v.id, starred: false });
    expect(getVisual(v.id)?.starred).toBe(0);
  });

  it("updateVisualMeta no-op when no fields provided", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    expect(() => updateVisualMeta({ visual_id: v.id })).not.toThrow();
    expect(getVisual(v.id)?.title).toBe("x");
  });

  it("createVisual persists description; setVisualDescription updates it", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({
      project_id: p.id,
      title: "Hero",
      type: "html",
      source: null,
      description: "dashboard header v1",
    });
    expect(v.description).toBe("dashboard header v1");
    expect(getVisual(v.id)?.description).toBe("dashboard header v1");
    setVisualDescription(v.id, "tightened copy");
    expect(getVisual(v.id)?.description).toBe("tightened copy");
    setVisualDescription(v.id, null);
    expect(getVisual(v.id)?.description).toBeNull();
  });

  it("createVisual defaults description to null when not supplied", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    expect(v.description).toBeNull();
    expect(getVisual(v.id)?.description).toBeNull();
  });

  it("archiveVisual hides from listVisualsForProject; restoreVisual reverses", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    archiveVisual(v.id);
    expect(listVisualsForProject(p.id).length).toBe(0);
    expect(listArchivedVisualsForProject(p.id).length).toBe(1);
    restoreVisual(v.id);
    expect(listVisualsForProject(p.id).length).toBe(1);
    expect(getVisual(v.id)?.archived_at).toBeNull();
  });

  it("listAllVisuals returns every non-archived visual across projects", () => {
    const p1 = createProject("p1", "mockup");
    const p2 = createProject("p2", "mockup");
    const a = createVisual({ project_id: p1.id, title: "a", type: "html", source: null });
    const b = createVisual({ project_id: p2.id, title: "b", type: "html", source: null });
    const c = createVisual({ project_id: p2.id, title: "c", type: "html", source: null });
    archiveVisual(c.id);
    const ids = listAllVisuals().map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("listStarred returns only starred + non-archived", () => {
    const p = createProject("p", "mockup");
    const a = createVisual({ project_id: p.id, title: "a", type: "html", source: null });
    const b = createVisual({ project_id: p.id, title: "b", type: "html", source: null });
    const c = createVisual({ project_id: p.id, title: "c", type: "html", source: null });
    updateVisualMeta({ visual_id: a.id, starred: true });
    updateVisualMeta({ visual_id: b.id, starred: true });
    archiveVisual(b.id);
    expect(listStarred().map((r) => r.id).sort()).toEqual([a.id].sort());
    expect(c.id).toBeDefined();
  });

  it("bumpCurrentVersion updates current_ver", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    bumpCurrentVersion(v.id, 5);
    expect(getVisual(v.id)?.current_ver).toBe(5);
  });
});

describe("searchVisuals", () => {
  it("filters compose AND-style and excludes archived", () => {
    const p1 = createProject("alpha", "mockup");
    const p2 = createProject("beta", "mockup");
    const v1 = createVisual({ project_id: p1.id, title: "Pricing page", type: "html", source: null });
    const v2 = createVisual({ project_id: p1.id, title: "Pricing diagram", type: "mermaid", source: null });
    const v3 = createVisual({ project_id: p2.id, title: "Pricing card", type: "html", source: null });
    const v4 = createVisual({ project_id: p1.id, title: "Other", type: "html", source: null });
    updateVisualMeta({ visual_id: v1.id, starred: true });
    archiveVisual(v4.id);
    const t = ensureTag("approved");
    attachTag(v1.id, t.id);

    expect(searchVisuals({}).length).toBe(3);
    expect(searchVisuals({ query: "pricing" }).length).toBe(3);
    expect(searchVisuals({ query: "pricing", project: "alpha" }).length).toBe(2);
    expect(searchVisuals({ query: "pricing", type: "html" }).map((r) => r.id).sort())
      .toEqual([v1.id, v3.id].sort());
    expect(searchVisuals({ starred: true }).map((r) => r.id)).toEqual([v1.id]);
    expect(searchVisuals({ tag: "approved" }).map((r) => r.id)).toEqual([v1.id]);

    const hit = searchVisuals({ tag: "approved" })[0]!;
    expect(hit.project_name).toBe("alpha");
    expect(hit.tag_names).toContain("approved");
    expect(v2.id).toBeDefined();
  });

  it("empty query string is treated as no filter", () => {
    const p = createProject("p", "mockup");
    createVisual({ project_id: p.id, title: "Anything", type: "html", source: null });
    expect(searchVisuals({ query: "   " }).length).toBe(1);
  });

  it("tags[] filter uses AND across multiple tags", () => {
    const p = createProject("p", "mockup");
    const v1 = createVisual({ project_id: p.id, title: "both", type: "html", source: null });
    const v2 = createVisual({ project_id: p.id, title: "only-a", type: "html", source: null });
    const v3 = createVisual({ project_id: p.id, title: "only-b", type: "html", source: null });
    const a = ensureTag("a");
    const b = ensureTag("b");
    attachTag(v1.id, a.id);
    attachTag(v1.id, b.id);
    attachTag(v2.id, a.id);
    attachTag(v3.id, b.id);
    expect(searchVisuals({ tags: ["a", "b"] }).map((r) => r.id)).toEqual([v1.id]);
    expect(searchVisuals({ tags: ["a"] }).map((r) => r.id).sort()).toEqual([v1.id, v2.id].sort());
  });

  it("tags[] composes with source filter", () => {
    const p = createProject("p", "mockup");
    const v1 = createVisual({ project_id: p.id, title: "stitch+a", type: "html", source: "stitch" });
    const v2 = createVisual({ project_id: p.id, title: "figma+a",  type: "html", source: "figma" });
    const a = ensureTag("a");
    attachTag(v1.id, a.id);
    attachTag(v2.id, a.id);
    expect(searchVisuals({ tags: ["a"], source: "stitch" }).map((r) => r.id)).toEqual([v1.id]);
  });

  it("backwards-compat: legacy tag arg still filters", () => {
    const p = createProject("p", "mockup");
    const v1 = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    const v2 = createVisual({ project_id: p.id, title: "y", type: "html", source: null });
    const t = ensureTag("approved");
    attachTag(v1.id, t.id);
    expect(searchVisuals({ tag: "approved" }).map((r) => r.id)).toEqual([v1.id]);
    expect(v2.id).toBeDefined();
  });

  it("source-only filter returns matching source", () => {
    const p = createProject("p", "mockup");
    const v1 = createVisual({ project_id: p.id, title: "f", type: "html", source: "figma" });
    const v2 = createVisual({ project_id: p.id, title: "s", type: "html", source: "stitch" });
    expect(searchVisuals({ source: "figma" }).map((r) => r.id)).toEqual([v1.id]);
    expect(v2.id).toBeDefined();
  });
});
