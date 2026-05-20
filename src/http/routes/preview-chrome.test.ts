import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { writeBlob } from "../../store/blobs.js";
import { closeDb } from "../../store/db.js";
import { createProject } from "../../store/projects.js";
import { appendVersion } from "../../store/versions.js";
import { archiveVisual, bumpCurrentVersion, createVisual, type VisualType } from "../../store/visuals.js";
import { mountVisualRoutes } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function seed(project_id: string, title: string, type: VisualType = "markdown", body?: string): string {
  const v = createVisual({ project_id, title, type, source: null });
  const content = body ?? `# ${title}\n`;
  const path = writeBlob({ visual_id: v.id, version_num: 1, type, content });
  appendVersion({ visual_id: v.id, version_num: 1, content_path: path, message: null });
  return v.id;
}

function addVersion(visual_id: string, n: number, type: VisualType = "markdown", body = "## v\n"): void {
  const path = writeBlob({ visual_id, version_num: n, type, content: body });
  appendVersion({ visual_id, version_num: n, content_path: path, message: null });
  bumpCurrentVersion(visual_id, n);
}

function buildApp(): Hono {
  const app = new Hono();
  mountVisualRoutes(app);
  return app;
}

describe("/v/:id preview chrome", () => {
  it("wraps preview with prev/next nav strip showing project + position", async () => {
    const p = createProject("specs", "mixed");
    const a = seed(p.id, "Spec A");
    const b = seed(p.id, "Spec B");
    const c = seed(p.id, "Spec C");
    const app = buildApp();

    // Sidebar order matches gallery (updated_at DESC) — C, B, A.
    const resB = await app.request(`/v/${b}`);
    expect(resB.status).toBe(200);
    const html = await resB.text();
    expect(html).toContain("class=\"chrome\"");
    expect(html).toContain("2 / 3");
    expect(html).toContain(`href="/v/${c}"`);
    expect(html).toContain(`href="/v/${a}"`);
    expect(html).toContain(">specs<");
    expect(html).toContain("Spec B");
  });

  it("first visual disables prev arrow, last disables next arrow", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "First");
    const b = seed(p.id, "Last");
    const app = buildApp();

    // Sidebar order = updated_at DESC → b (most recent) then a.
    const resB = await app.request(`/v/${b}`);
    const htmlB = await resB.text();
    expect(htmlB).toContain('class="nav-btn disabled"');
    expect(htmlB).toContain(`href="/v/${a}"`);

    const resA = await app.request(`/v/${a}`);
    const htmlA = await resA.text();
    expect(htmlA).toContain('class="nav-btn disabled"');
    expect(htmlA).toContain(`href="/v/${b}"`);
  });

  it("?chrome=0 suppresses the wrapper", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Solo");
    const app = buildApp();

    const resBare = await app.request(`/v/${a}?chrome=0`);
    const html = await resBare.text();
    expect(html).not.toContain("class=\"chrome\"");
    expect(html).not.toContain("nav-btn");
    expect(html).toContain("<h1");
  });

  it("nav skips archived siblings", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "A");
    const b = seed(p.id, "B");
    const c = seed(p.id, "C");
    archiveVisual(b);
    const app = buildApp();

    // Sidebar order = updated_at DESC → c then a (b archived, excluded).
    const resA = await app.request(`/v/${a}`);
    const html = await resA.text();
    expect(html).toContain("2 / 2");
    expect(html).toContain(`href="/v/${c}"`);
    expect(html).not.toContain(`href="/v/${b}"`);
  });

  it("solo visual shows 1 / 1 with both nav arrows disabled", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Only");
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).toContain("1 / 1");
    expect((html.match(/class="nav-btn disabled"/g) ?? []).length).toBe(2);
  });

  it("emits keyboard handler bound to ArrowLeft/ArrowRight only (no vim j/k)", async () => {
    const p = createProject("p", "mixed");
    seed(p.id, "A");
    const b = seed(p.id, "B");
    const app = buildApp();

    const res = await app.request(`/v/${b}`);
    const html = await res.text();
    expect(html).toContain('e.key === "ArrowLeft"');
    expect(html).toContain('e.key === "ArrowRight"');
    expect(html).not.toContain('e.key === "j"');
    expect(html).not.toContain('e.key === "k"');
  });

  it("renders archived banner when visual is archived", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Sketches");
    archiveVisual(a);
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).toContain('class="archive-banner"');
    expect(html).toContain("Archived.");
    expect(html).toContain("Restore");
  });

  it("renders historical sub-strip when viewing an older version", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    addVersion(a, 3);
    const app = buildApp();

    const res = await app.request(`/v/${a}?ver=1`);
    const html = await res.text();
    expect(html).toContain('class="historical-strip"');
    expect(html).toContain("<b>v1</b> of <b>3</b>");
    expect(html).toContain("Open current →");
  });

  it("does not render historical strip when on current version", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).not.toContain('class="historical-strip"');
  });

  it("emits version pill with current/older variant + type pill", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const current = await app.request(`/v/${a}`);
    const htmlC = await current.text();
    expect(htmlC).toContain('class="ver-pill current"');
    expect(htmlC).toContain('class="type-pill">markdown');

    const older = await app.request(`/v/${a}?ver=1`);
    const htmlO = await older.text();
    expect(htmlO).toContain('class="ver-pill old"');
  });

  it("renders Compare-to-current action only on older versions", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    addVersion(a, 3);
    const app = buildApp();

    const older = await app.request(`/v/${a}?ver=1`);
    const htmlO = await older.text();
    expect(htmlO).toContain("Compare to current");
    expect(htmlO).toContain(`href="/compare/${a}?a=1&b=3"`);

    const current = await app.request(`/v/${a}`);
    const htmlC = await current.text();
    expect(htmlC).not.toContain("Compare to current");
  });

  it("emits more-menu details element with Re-render/Download/Copy actions", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).toContain('class="more-menu"');
    expect(html).toContain("Open in dashboard");
    expect(html).toContain("Copy link");
    expect(html).toContain("Download source");
    expect(html).toContain(`href="/api/visuals/${a}/source?ver=1"`);
  });

  it("emits copy-link script with clipboard write", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).toContain("data-copy-link");
    expect(html).toContain("navigator.clipboard.writeText");
  });

  it("renders render-fail card inside chrome when dot source is invalid", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Bad DOT", "dot", "this is not valid graphviz {{");
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="chrome"');
    expect(html).toContain('class="error-card"');
    expect(html).toContain("Render failed");
    expect(html).toContain("Retry");
    expect(html).toContain("View source");
  });

  it("returns chrome-wrapped render-fail card with 404 when blob missing on disk", async () => {
    const p = createProject("orphans", "mixed");
    const v = createVisual({ project_id: p.id, title: "Orphaned visual", type: "svg", source: null });
    appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "C:/does/not/exist/v1.svg",
      message: null,
    });
    bumpCurrentVersion(v.id, 1);
    const app = buildApp();

    const res = await app.request(`/v/${v.id}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('class="chrome"');
    expect(html).toContain('class="error-card"');
    expect(html).toContain("Source file is missing on disk");
    expect(html).toContain("Orphaned visual");
  });

  it("/thumbs returns SVG placeholder + 200 when blob missing (download=1 still 404)", async () => {
    const p = createProject("p", "mixed");
    const v = createVisual({ project_id: p.id, title: "no-thumb", type: "html", source: null });
    appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "C:/does/not/exist/v1.html",
      message: null,
    });
    const app = buildApp();

    const res = await app.request(`/thumbs/${v.id}/v1.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("NO THUMBNAIL");

    const dl = await app.request(`/thumbs/${v.id}/v1.png?download=1`);
    expect(dl.status).toBe(404);
  });

  it("bakes data-theme onto <html> when magpie_theme cookie is set", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "Themed");
    const app = buildApp();

    const dark = await app.request(`/v/${id}`, { headers: { Cookie: "magpie_theme=dark" } });
    expect(dark.status).toBe(200);
    const darkHtml = await dark.text();
    expect(darkHtml).toMatch(/<html lang="en" data-theme="dark">/);

    const light = await app.request(`/v/${id}`, { headers: { Cookie: "other=1; magpie_theme=light" } });
    const lightHtml = await light.text();
    expect(lightHtml).toMatch(/<html lang="en" data-theme="light">/);

    const none = await app.request(`/v/${id}`);
    const noneHtml = await none.text();
    expect(noneHtml).toMatch(/<html lang="en">/);
    expect(noneHtml).toContain("getAttribute('data-theme')");
  });
});

describe("pane sandbox + postMessage bridge (G-120/G-121, Phase B)", () => {
  it("html iframe inside chrome drops allow-same-origin", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Page", "html", "<!doctype html><html><body>x</body></html>");
    const app = buildApp();

    const res = await app.request(`/v/${a}`);
    const html = await res.text();
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("compare page panes drop allow-same-origin", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc");
    addVersion(a, 2);
    const app = buildApp();

    const res = await app.request(`/compare/${a}`);
    const html = await res.text();
    expect((html.match(/sandbox="allow-scripts"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("allow-same-origin");
  });

  it("chrome=0 markdown body includes pane bridge with vid + ver", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Doc", "markdown", "# Hi");
    const app = buildApp();

    const res = await app.request(`/v/${a}?chrome=0`);
    const body = await res.text();
    expect(body).toContain("magpie-pane");
    expect(body).toContain("kind:\"ready\"");
    expect(body).toContain(JSON.stringify(a));
    expect(body).toContain("scrollTo");
  });

  it("chrome=0 html body appends bridge after content", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Page", "html", "<!doctype html><html><body>x</body></html>");
    const app = buildApp();

    const res = await app.request(`/v/${a}?chrome=0`);
    const body = await res.text();
    expect(body).toContain("<body>x</body>");
    expect(body).toContain("magpie-pane");
    expect(body.indexOf("magpie-pane")).toBeGreaterThan(body.indexOf("</body>"));
  });

  it("chrome=0 mermaid body includes bridge", async () => {
    const p = createProject("p", "mixed");
    const a = seed(p.id, "Diag", "mermaid", "graph TD; A-->B");
    const app = buildApp();

    const res = await app.request(`/v/${a}?chrome=0`);
    const body = await res.text();
    expect(body).toContain("magpie-pane");
  });
});
