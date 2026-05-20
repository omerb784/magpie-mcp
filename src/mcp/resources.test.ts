import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { insertInbox, markConsumed } from "../store/inbox.js";
import { createProject } from "../store/projects.js";
import { createVisual } from "../store/visuals.js";
import { listResources, readResource } from "./resources.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("magpie://inbox resource (P1.D)", () => {
  it("listResources surfaces the inbox descriptor with lane counts", () => {
    insertInbox({ prompt_body: "p1" });
    const a = insertInbox({ prompt_body: "p2" });
    markConsumed([a.id]);

    const resources = listResources();
    const inbox = resources.find((r) => r.uri === "magpie://inbox");
    expect(inbox).toBeDefined();
    expect(inbox?.mimeType).toBe("application/json");
    expect(inbox?.description).toContain("1 pending");
    expect(inbox?.description).toContain("1 consumed");
  });

  it("readResource returns {pending, consumed} JSON with enriched visual_title", () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    insertInbox({ visual_id: visual.id, prompt_body: "iterate hero" });
    const consumed = insertInbox({ visual_id: visual.id, prompt_body: "old prompt" });
    markConsumed([consumed.id]);

    const result = readResource("magpie://inbox");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("application/json");
    const json = JSON.parse(result.text) as {
      pending: Array<{ id: string; visual_title: string | null; prompt_body: string }>;
      consumed: Array<{ id: string; visual_title: string | null; prompt_body: string }>;
    };
    expect(json.pending).toHaveLength(1);
    expect(json.consumed).toHaveLength(1);
    expect(json.pending[0].prompt_body).toBe("iterate hero");
    expect(json.pending[0].visual_title).toBe("Hero");
    expect(json.consumed[0].visual_title).toBe("Hero");
  });

  it("readResource handles trailing slash variant (magpie://inbox/)", () => {
    const result = readResource("magpie://inbox/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("application/json");
    const json = JSON.parse(result.text) as { pending: unknown[]; consumed: unknown[] };
    expect(json.pending).toEqual([]);
    expect(json.consumed).toEqual([]);
  });

  it("renders null visual_title when entry has no visual_id (free-form send)", () => {
    insertInbox({ prompt_body: "free form" });
    const result = readResource("magpie://inbox");
    if (!result.ok) throw new Error(result.reason);
    const json = JSON.parse(result.text) as {
      pending: Array<{ visual_id: string | null; visual_title: string | null }>;
    };
    expect(json.pending[0].visual_id).toBeNull();
    expect(json.pending[0].visual_title).toBeNull();
  });

  it("preserves existing library + project resources", () => {
    createProject("alpha", "mockup");
    const lib = readResource("magpie://library");
    expect(lib.ok).toBe(true);
    const proj = readResource("magpie://project/alpha");
    expect(proj.ok).toBe(true);
  });
});

describe("magpie://visual/<id> resource — path pointer", () => {
  it("returns JSON pointer (content_path) instead of inline body", async () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    const { writeBlob } = await import("../store/blobs.js");
    const { appendVersion } = await import("../store/versions.js");
    const { bumpCurrentVersion } = await import("../store/visuals.js");
    const p = writeBlob({ visual_id: visual.id, version_num: 1, type: "html", content: "<h1>v1</h1>" });
    appendVersion({ visual_id: visual.id, version_num: 1, content_path: p, message: null });
    bumpCurrentVersion(visual.id, 1);

    const result = readResource(`magpie://visual/${visual.id}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("application/json");
    const json = JSON.parse(result.text) as {
      visual_id: string;
      version_num: number;
      type: string;
      content_mime: string;
      content_path: string;
    };
    expect(json.visual_id).toBe(visual.id);
    expect(json.version_num).toBe(1);
    expect(json.type).toBe("html");
    expect(json.content_mime).toBe("text/html");
    expect(json.content_path).toBe(p);
    expect(json.content_path).toMatch(/v1\.html$/);
    expect(result.text).not.toContain("<h1>v1</h1>");
  });

  it("resolves /v{n} suffix to a specific version pointer", async () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    const { writeBlob } = await import("../store/blobs.js");
    const { appendVersion } = await import("../store/versions.js");
    const { bumpCurrentVersion } = await import("../store/visuals.js");
    const p1 = writeBlob({ visual_id: visual.id, version_num: 1, type: "html", content: "<h1>v1</h1>" });
    appendVersion({ visual_id: visual.id, version_num: 1, content_path: p1, message: null });
    const p2 = writeBlob({ visual_id: visual.id, version_num: 2, type: "html", content: "<h1>v2</h1>" });
    appendVersion({ visual_id: visual.id, version_num: 2, content_path: p2, message: null });
    bumpCurrentVersion(visual.id, 2);

    const result = readResource(`magpie://visual/${visual.id}/v1`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.parse(result.text) as { version_num: number; content_path: string };
    expect(json.version_num).toBe(1);
    expect(json.content_path).toBe(p1);
  });

  it("errors cleanly when visual not found", () => {
    const result = readResource("magpie://visual/nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("visual nope not found");
  });

  it("surfaces per-version message + description on the visual resource (v0.9.2 Phase A)", async () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    const { writeBlob } = await import("../store/blobs.js");
    const { appendVersion } = await import("../store/versions.js");
    const { bumpCurrentVersion } = await import("../store/visuals.js");
    const p1 = writeBlob({ visual_id: visual.id, version_num: 1, type: "html", content: "<h1>v1</h1>" });
    appendVersion({
      visual_id: visual.id,
      version_num: 1,
      content_path: p1,
      message: "initial draft",
      description: "First pass at the hero. Two-column layout, mossy CTA.",
    });
    bumpCurrentVersion(visual.id, 1);

    const result = readResource(`magpie://visual/${visual.id}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.parse(result.text) as {
      message: string | null;
      description: string | null;
    };
    expect(json.message).toBe("initial draft");
    expect(json.description).toContain("Two-column layout");
  });

  it("returns NULL description when the version has none (backward-safe)", async () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    const { writeBlob } = await import("../store/blobs.js");
    const { appendVersion } = await import("../store/versions.js");
    const { bumpCurrentVersion } = await import("../store/visuals.js");
    const p = writeBlob({ visual_id: visual.id, version_num: 1, type: "html", content: "<h1>v1</h1>" });
    appendVersion({ visual_id: visual.id, version_num: 1, content_path: p, message: null });
    bumpCurrentVersion(visual.id, 1);

    const result = readResource(`magpie://visual/${visual.id}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.parse(result.text) as {
      message: string | null;
      description: string | null;
    };
    expect(json.message).toBeNull();
    expect(json.description).toBeNull();
  });
});
