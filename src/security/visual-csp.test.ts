import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { writeBlob } from "../store/blobs.js";
import { closeDb } from "../store/db.js";
import { createProject } from "../store/projects.js";
import { appendVersion } from "../store/versions.js";
import { createVisual, type VisualType } from "../store/visuals.js";
import { mountVisualRoutes, previewCsp } from "../http/routes/visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function seed(project_id: string, title: string, type: VisualType, body: string): string {
  const v = createVisual({ project_id, title, type, source: null });
  const path = writeBlob({ visual_id: v.id, version_num: 1, type, content: body });
  appendVersion({ visual_id: v.id, version_num: 1, content_path: path, message: null });
  return v.id;
}

function buildApp(): Hono {
  const app = new Hono();
  mountVisualRoutes(app);
  return app;
}

describe("A2 · CSP on chrome=0 visual responses (per Owner decision v lean)", () => {
  it("previewCsp('svg') is the strictest — no script-src, no default-src 'self'", () => {
    const csp = previewCsp("svg");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("connect-src");
  });

  it("previewCsp('html') allows inline script (Claude-authored visuals can include <script>) but blocks fetch via connect-src 'none'", () => {
    const csp = previewCsp("html");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("previewCsp() for renderer-backed types (mermaid/dot/vega-lite/d2/markdown) blocks connect-src and pins frame-ancestors", () => {
    for (const t of ["mermaid", "markdown", "dot", "vega-lite", "d2"] as const) {
      const csp = previewCsp(t);
      expect(csp, `csp for ${t}`).toContain("connect-src 'none'");
      expect(csp, `csp for ${t}`).toContain("frame-ancestors 'self'");
    }
  });

  it("html chrome=0 response carries the html CSP header", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "X", "html", "<!doctype html><html><body>x</body></html>");
    const app = buildApp();
    const res = await app.request(`/v/${id}?chrome=0`);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBe(previewCsp("html"));
  });

  it("svg chrome=0 response carries the svg CSP header (no script-src)", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "X", "svg", "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>");
    const app = buildApp();
    const res = await app.request(`/v/${id}?chrome=0`);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBe(previewCsp("svg"));
    expect(csp).not.toContain("script-src");
  });

  it("markdown chrome=0 response carries the markdown CSP header", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "X", "markdown", "# hi");
    const app = buildApp();
    const res = await app.request(`/v/${id}?chrome=0`);
    expect(res.headers.get("Content-Security-Policy")).toBe(previewCsp("markdown"));
  });

  it("mermaid chrome=0 response carries the mermaid CSP header", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "X", "mermaid", "graph LR; A-->B");
    const app = buildApp();
    const res = await app.request(`/v/${id}?chrome=0`);
    expect(res.headers.get("Content-Security-Policy")).toBe(previewCsp("mermaid"));
  });

  it("html iframe attribute still uses sandbox=\"allow-scripts\" (no allow-same-origin) — chrome=1 path", async () => {
    const p = createProject("p", "mixed");
    const id = seed(p.id, "X", "html", "<!doctype html><html><body>x</body></html>");
    const app = buildApp();
    const res = await app.request(`/v/${id}`);
    const html = await res.text();
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("CSP and sandbox are belt-and-suspenders — neither allows the iframe to reach back to Magpie's API (connect-src 'none' + null origin from missing allow-same-origin)", () => {
    // This is a static-analysis-style assertion: the CSP for every type with
    // any script-execution capability declares connect-src 'none', and the
    // iframe sandbox in the chrome=1 response never includes allow-same-origin
    // (covered by preview-chrome.test.ts line 309-311 and 321-322).
    for (const t of ["html", "mermaid", "markdown", "dot", "vega-lite", "d2"] as const) {
      expect(previewCsp(t)).toContain("connect-src 'none'");
    }
  });
});
