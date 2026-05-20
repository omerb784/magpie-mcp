import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { writeBlob } from "../../store/blobs.js";
import { closeDb } from "../../store/db.js";
import { createProject } from "../../store/projects.js";
import { appendVersion } from "../../store/versions.js";
import { archiveVisual, bumpCurrentVersion, createVisual, type VisualType } from "../../store/visuals.js";
import { mountVisualRoutes } from "./visuals.js";
import { deriveState, type PaneRef } from "./compare-shell.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function seed(project_id: string, title: string, type: VisualType = "markdown"): string {
  const v = createVisual({ project_id, title, type, source: null });
  const path = writeBlob({ visual_id: v.id, version_num: 1, type, content: `# ${title}\n` });
  appendVersion({ visual_id: v.id, version_num: 1, content_path: path, message: null });
  return v.id;
}

function addVersion(visual_id: string, n: number, type: VisualType = "markdown"): void {
  const path = writeBlob({ visual_id, version_num: n, type, content: `## v${n}\n` });
  appendVersion({ visual_id, version_num: n, content_path: path, message: null });
  bumpCurrentVersion(visual_id, n);
}

function buildApp(): Hono {
  const app = new Hono();
  mountVisualRoutes(app);
  return app;
}

describe("deriveState (Phase C)", () => {
  const a: PaneRef = { vid: "v1", ver: 1 };
  const b: PaneRef = { vid: "v1", ver: 2 };

  it("returns single when b is null", () => {
    expect(deriveState({ a, b: null, currentVer: 3, mode: "sxs" })).toEqual({
      kind: "single",
      pane: a,
    });
  });

  it("returns comparable when both versions distinct", () => {
    expect(deriveState({ a, b, currentVer: 2, mode: "sxs" })).toEqual({
      kind: "comparable",
      a,
      b,
      mode: "sxs",
    });
  });

  it("returns not-comparable v1-only when same version + currentVer is 1", () => {
    const r = deriveState({ a, b: a, currentVer: 1, mode: "sxs" });
    expect(r).toEqual({ kind: "not-comparable", a, b: a, reason: "v1-only" });
  });

  it("returns not-comparable a-equals-b when same version + multiple versions exist", () => {
    const r = deriveState({ a: b, b, currentVer: 3, mode: "sxs" });
    expect(r).toEqual({ kind: "not-comparable", a: b, b, reason: "a-equals-b" });
  });

  it("preserves mode in comparable state", () => {
    const r = deriveState({ a, b, currentVer: 2, mode: "overlay" });
    expect(r).toEqual({ kind: "comparable", a, b, mode: "overlay" });
  });
});

describe("/compare/:id shell (Phase C)", () => {
  it("renders comparable state with default a=current-1, b=current", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    addVersion(a, 3);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="stage state-comparable"');
    expect(html).toContain('data-mode="sxs"');
    expect(html).toContain("v2"); // a default = current-1 = 2
    expect(html).toContain("v3"); // b default = current = 3
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("renders not-comparable v1-only when only v1 exists", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Solo");
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="stage state-not-comparable"');
    expect(html).toContain("Only one version exists yet");
    expect(html).toContain("iterate(visual_id");
  });

  it("renders not-comparable a-equals-b when explicitly same versions picked", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    addVersion(a, 3);
    const app = buildApp();

    const res = await app.request(`/compare/${a}?a=2&b=2`);
    const html = await res.text();
    expect(html).toContain('class="stage state-not-comparable"');
    expect(html).toContain("Same version on both sides");
    expect(html).toContain("prev ↔ current");
  });

  it("renders single state when b is empty string", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}?b=`);
    const html = await res.text();
    expect(html).toContain('class="stage state-single"');
    expect(html).toContain('class="pane pane-only"');
    expect(html).toContain("+ pane B");
  });

  it("404s on bad version number", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}?a=99&b=2`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("99");
  });

  it("renders mode switcher with sxs + overlay buttons", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    const html = await res.text();
    expect(html).toContain('data-mode="sxs"');
    expect(html).toContain('data-mode="overlay"');
    expect(html).toMatch(/class="mode on"[^>]*data-mode="sxs"/);
  });

  it("renders overlay mode with slider when ?mode=overlay", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}?mode=overlay`);
    const html = await res.text();
    expect(html).toContain('data-mode="overlay"');
    expect(html).toContain("data-overlay");
    expect(html).toContain("overlay-control");
  });

  it("renders archived banner when visual is archived", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    archiveVisual(a);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    const html = await res.text();
    expect(html).toContain('class="archive-banner"');
    expect(html).toContain("Archived.");
  });

  it("emits version pickers with options for all available versions", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    addVersion(a, 3);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    const html = await res.text();
    expect(html).toContain('data-picker="a-ver"');
    expect(html).toContain('data-picker="b-ver"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="3"');
    expect(html).toContain("v3 · current");
  });

  it("emits swap button + remove + add controls", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const both = await app.request(`/compare/${a}`);
    const htmlBoth = await both.text();
    expect(htmlBoth).toContain("data-swap");
    expect(htmlBoth).toContain('data-remove="b"');

    const single = await app.request(`/compare/${a}?b=`);
    const htmlSingle = await single.text();
    expect(htmlSingle).toContain('data-add="b"');
  });

  it("emits postMessage relay for sync-scroll", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    const html = await res.text();
    expect(html).toContain("magpie-pane");
    expect(html).toContain("scrollTo");
  });

  it("bakes data-theme onto <html> when magpie_theme cookie is set", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`, { headers: { Cookie: "magpie_theme=dark" } });
    const html = await res.text();
    expect(html).toContain('data-theme="dark"');
  });
});
