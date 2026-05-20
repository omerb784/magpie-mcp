import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import { createProject } from "../../store/projects.js";
import { attachTag, ensureTag } from "../../store/tags.js";
import { appendVersion } from "../../store/versions.js";
import { writeBlob } from "../../store/blobs.js";
import {
  bumpCurrentVersion,
  createVisual,
  VISUAL_TYPE_VALUES,
  type Visual,
  type VisualType,
} from "../../store/visuals.js";
import { mountSearchRoutes } from "./search.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountSearchRoutes(app);
  return app;
}

async function getJson<T>(app: Hono, path: string): Promise<T> {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("GET /api/search", () => {
  it("AND-composes repeated tag query params", async () => {
    const p = createProject("p", "mockup");
    const both = createVisual({ project_id: p.id, title: "both", type: "html", source: "stitch" });
    const onlyA = createVisual({ project_id: p.id, title: "onlyA", type: "html", source: "stitch" });
    const a = ensureTag("a");
    const b = ensureTag("b");
    attachTag(both.id, a.id);
    attachTag(both.id, b.id);
    attachTag(onlyA.id, a.id);

    const rows = await getJson<Visual[]>(buildApp(), "/api/search?tag=a&tag=b&source=stitch");
    expect(rows.map((r) => r.id)).toEqual([both.id]);
  });

  it("AND-composes project + tag (tag filter scoped to selected project)", async () => {
    const alpha = createProject("alpha", "mockup");
    const beta = createProject("beta", "mockup");
    const a1 = createVisual({ project_id: alpha.id, title: "a1", type: "html", source: null });
    const a2 = createVisual({ project_id: alpha.id, title: "a2", type: "html", source: null });
    const b1 = createVisual({ project_id: beta.id, title: "b1", type: "html", source: null });
    const approved = ensureTag("approved");
    attachTag(a1.id, approved.id);
    attachTag(b1.id, approved.id);
    expect(a2.id).toBeDefined();

    const inAlpha = await getJson<Visual[]>(buildApp(), "/api/search?project=alpha&tag=approved");
    expect(inAlpha.map((r) => r.id)).toEqual([a1.id]);
    const inBeta = await getJson<Visual[]>(buildApp(), "/api/search?project=beta&tag=approved");
    expect(inBeta.map((r) => r.id)).toEqual([b1.id]);
  });

  it("rejects unknown source values", async () => {
    const res = await buildApp().fetch(
      new Request("http://localhost/api/search?source=bogus")
    );
    expect(res.status).toBe(400);
  });

  it("source filter narrows results", async () => {
    const p = createProject("p", "mockup");
    const f = createVisual({ project_id: p.id, title: "f", type: "html", source: "figma" });
    const s = createVisual({ project_id: p.id, title: "s", type: "html", source: "stitch" });
    const rows = await getJson<Visual[]>(buildApp(), "/api/search?source=figma");
    expect(rows.map((r) => r.id)).toEqual([f.id]);
    expect(s.id).toBeDefined();
  });

  it("type filter narrows for every supported type", async () => {
    const p = createProject("p", "mixed");
    const ids = new Map<VisualType, string>();
    for (const t of VISUAL_TYPE_VALUES) {
      const v = createVisual({ project_id: p.id, title: `${t}-card`, type: t, source: "claude" });
      ids.set(t, v.id);
    }
    const app = buildApp();
    for (const t of VISUAL_TYPE_VALUES) {
      const rows = await getJson<Visual[]>(app, `/api/search?type=${encodeURIComponent(t)}`);
      expect(rows.map((r) => r.id)).toEqual([ids.get(t)]);
      expect(rows.every((r) => r.type === t)).toBe(true);
    }
  });

  it("unknown type silently ignored (returns full set)", async () => {
    const p = createProject("p", "mockup");
    createVisual({ project_id: p.id, title: "h", type: "html", source: "claude" });
    createVisual({ project_id: p.id, title: "m", type: "mermaid", source: "claude" });
    const rows = await getJson<Visual[]>(buildApp(), "/api/search?type=bogus");
    expect(rows.length).toBe(2);
  });

  it("hits include current_render_status + thumb_version for grid card thumb logic", async () => {
    const p = createProject("p", "mixed");
    const v = createVisual({ project_id: p.id, title: "thumbed", type: "html", source: "claude" });
    const path = writeBlob({ visual_id: v.id, version_num: 1, type: "html", content: "<p>1</p>" });
    appendVersion({ visual_id: v.id, version_num: 1, content_path: path, message: null });
    bumpCurrentVersion(v.id, 1);
    const rows = await getJson<Array<Visual & { current_render_status: string | null; thumb_version: number | null }>>(
      buildApp(),
      "/api/search"
    );
    expect(rows.length).toBe(1);
    expect(rows[0].thumb_version).toBe(1);
    expect(rows[0].current_render_status).toBe("pending");
  });
});

describe("GET /api/config-snippet", () => {
  async function fetchSnippet(qs = ""): Promise<{ status: number; body: string }> {
    const res = await buildApp().fetch(new Request(`http://localhost/api/config-snippet${qs}`));
    return { status: res.status, body: await res.text() };
  }

  it("?host=code returns Claude Code snippet only", async () => {
    const r = await fetchSnippet("?host=code");
    expect(r.status).toBe(200);
    expect(r.body).toContain("Claude Code");
    expect(r.body).toContain(`"type": "stdio"`);
    expect(r.body).not.toContain("Claude Desktop");
  });

  it("?host=desktop returns Claude Desktop snippet only", async () => {
    const r = await fetchSnippet("?host=desktop");
    expect(r.status).toBe(200);
    expect(r.body).toContain("Claude Desktop");
    expect(r.body).not.toContain("Claude Code");
    expect(r.body).not.toContain(`"type": "stdio"`);
  });

  it("?host=all returns combined snippet", async () => {
    const r = await fetchSnippet("?host=all");
    expect(r.status).toBe(200);
    expect(r.body).toContain("Claude Code");
    expect(r.body).toContain("Claude Desktop");
  });

  it("omitted host defaults to code", async () => {
    const r = await fetchSnippet();
    expect(r.status).toBe(200);
    expect(r.body).toContain("Claude Code");
    expect(r.body).not.toContain("Claude Desktop");
  });

  it("invalid host returns 400", async () => {
    const r = await fetchSnippet("?host=evil");
    expect(r.status).toBe(400);
  });
});
