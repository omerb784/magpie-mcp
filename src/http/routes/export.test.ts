import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { thumbPath } from "../../render/index.js";
import { writeBlob } from "../../store/blobs.js";
import { closeDb } from "../../store/db.js";
import { createProject } from "../../store/projects.js";
import { ensureTag, attachTag } from "../../store/tags.js";
import { appendVersion, setRenderStatus } from "../../store/versions.js";
import { createVisual } from "../../store/visuals.js";
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
  mountVisualRoutes(app);
  mountProjectRoutes(app);
  return app;
}

function seedVisual(args: {
  project_id: string;
  title: string;
  type: "html" | "markdown" | "dot";
  content: string;
  withThumb?: boolean;
}): string {
  const v = createVisual({
    project_id: args.project_id,
    title: args.title,
    type: args.type,
    source: null,
  });
  const path = writeBlob({
    visual_id: v.id,
    version_num: 1,
    type: args.type,
    content: args.content,
  });
  const ver = appendVersion({
    visual_id: v.id,
    version_num: 1,
    content_path: path,
    message: null,
  });
  if (args.withThumb) {
    const tp = thumbPath(v.id, 1);
    mkdirSync(tp.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
    writeFileSync(tp, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    setRenderStatus({ version_id: ver.id, status: "ok", thumb_path: tp, error: null });
  }
  return v.id;
}

describe("GET /api/visuals/:id/source", () => {
  it("returns the raw blob with attachment Content-Disposition", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "Hello World",
      type: "html",
      content: "<html><body>hi</body></html>",
    });
    const res = await buildApp().fetch(new Request(`http://localhost/api/visuals/${id}/source`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="hello-world-v1.html"`
    );
    expect(await res.text()).toBe("<html><body>hi</body></html>");
  });

  it("falls back to id when title slugifies empty", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "———",
      type: "markdown",
      content: "# H1",
    });
    const res = await buildApp().fetch(new Request(`http://localhost/api/visuals/${id}/source`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${id}-v1.md"`
    );
  });

  it("404s on unknown visual", async () => {
    const res = await buildApp().fetch(new Request(`http://localhost/api/visuals/ghost/source`));
    expect(res.status).toBe(404);
  });
});

describe("GET /thumbs/:id/v:n.png", () => {
  it("inline (legacy) by default — no Content-Disposition", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "Card",
      type: "html",
      content: "<html/>",
      withThumb: true,
    });
    const res = await buildApp().fetch(new Request(`http://localhost/thumbs/${id}/v1.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });

  it("flips to attachment when ?download=1", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "Card",
      type: "html",
      content: "<html/>",
      withThumb: true,
    });
    const res = await buildApp().fetch(
      new Request(`http://localhost/thumbs/${id}/v1.png?download=1`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="card-v1.png"`
    );
  });
});

describe("GET /api/visuals/:id/render.svg", () => {
  it("returns 415 for html (no SVG)", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "x",
      type: "html",
      content: "<html/>",
    });
    const res = await buildApp().fetch(
      new Request(`http://localhost/api/visuals/${id}/render.svg`)
    );
    expect(res.status).toBe(415);
  });

  it("returns 415 for markdown (no SVG)", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "x",
      type: "markdown",
      content: "# H",
    });
    const res = await buildApp().fetch(
      new Request(`http://localhost/api/visuals/${id}/render.svg`)
    );
    expect(res.status).toBe(415);
  });

  it("renders dot to SVG", async () => {
    const p = createProject("p", "mockup");
    const id = seedVisual({
      project_id: p.id,
      title: "Pipeline",
      type: "dot",
      content: "digraph G { a -> b }",
    });
    const res = await buildApp().fetch(
      new Request(`http://localhost/api/visuals/${id}/render.svg`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toContain("pipeline-v1.svg");
    const body = await res.text();
    expect(body).toContain("<svg");
  });
});

describe("GET /api/projects/:name/export.zip", () => {
  it("produces a valid zip with manifest + meta + blob + thumb", async () => {
    const p = createProject("ship-it", "mockup");
    const tag = ensureTag("wip");
    const id = seedVisual({
      project_id: p.id,
      title: "Card One",
      type: "html",
      content: "<html><body>hi</body></html>",
      withThumb: true,
    });
    attachTag(id, tag.id);

    const res = await buildApp().fetch(
      new Request(`http://localhost/api/projects/ship-it/export.zip`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("magpie__ship-it__");

    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries).sort();
    expect(names).toContain("ship-it/manifest.json");
    expect(names.some((n) => n.endsWith("/meta.json"))).toBe(true);
    expect(names.some((n) => n.endsWith("/v1.html"))).toBe(true);
    expect(names.some((n) => n.endsWith("/v1.png"))).toBe(true);

    const manifest = JSON.parse(strFromU8(entries["ship-it/manifest.json"]));
    expect(manifest.project_name).toBe("ship-it");
    expect(manifest.versions_mode).toBe("current");
    expect(manifest.visual_count).toBe(1);

    const metaName = names.find((n) => n.endsWith("/meta.json"))!;
    const meta = JSON.parse(strFromU8(entries[metaName]));
    expect(meta.title).toBe("Card One");
    expect(meta.type).toBe("html");
    expect(meta.tags).toEqual(["wip"]);
    expect(meta.included_versions).toEqual([1]);
  });

  it("?versions=all includes every saved version", async () => {
    const p = createProject("multi", "mockup");
    const v = createVisual({ project_id: p.id, title: "Card", type: "html", source: null });
    const p1 = writeBlob({ visual_id: v.id, version_num: 1, type: "html", content: "<v1/>" });
    const p2 = writeBlob({ visual_id: v.id, version_num: 2, type: "html", content: "<v2/>" });
    appendVersion({ visual_id: v.id, version_num: 1, content_path: p1, message: null });
    appendVersion({ visual_id: v.id, version_num: 2, content_path: p2, message: null });

    const res = await buildApp().fetch(
      new Request(`http://localhost/api/projects/multi/export.zip?versions=all`)
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries);
    expect(names.some((n) => n.endsWith("/v1.html"))).toBe(true);
    expect(names.some((n) => n.endsWith("/v2.html"))).toBe(true);

    const metaName = names.find((n) => n.endsWith("/meta.json"))!;
    const meta = JSON.parse(strFromU8(entries[metaName]));
    expect(meta.included_versions).toEqual([1, 2]);
  });

  it("default mode includes only current version", async () => {
    const p = createProject("def", "mockup");
    const v = createVisual({ project_id: p.id, title: "Card", type: "html", source: null });
    const p1 = writeBlob({ visual_id: v.id, version_num: 1, type: "html", content: "<v1/>" });
    appendVersion({ visual_id: v.id, version_num: 1, content_path: p1, message: null });
    const p2 = writeBlob({ visual_id: v.id, version_num: 2, type: "html", content: "<v2/>" });
    appendVersion({ visual_id: v.id, version_num: 2, content_path: p2, message: null });
    // current_ver still 1 because we didn't bump it; the route filters on current_ver
    // (helper appendVersion does not touch current_ver in this test setup).

    const res = await buildApp().fetch(
      new Request(`http://localhost/api/projects/def/export.zip`)
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries);
    expect(names.some((n) => n.endsWith("/v1.html"))).toBe(true);
    expect(names.some((n) => n.endsWith("/v2.html"))).toBe(false);
  });

  it("404s on unknown project", async () => {
    const res = await buildApp().fetch(
      new Request(`http://localhost/api/projects/ghost/export.zip`)
    );
    expect(res.status).toBe(404);
  });

  it("skips versions whose blob is missing on disk", async () => {
    const p = createProject("gappy", "mockup");
    const v = createVisual({ project_id: p.id, title: "Gap", type: "html", source: null });
    appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/nonexistent/path/v1.html",
      message: null,
    });

    const res = await buildApp().fetch(
      new Request(`http://localhost/api/projects/gappy/export.zip?versions=all`)
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const names = Object.keys(entries);
    expect(names.some((n) => n.endsWith("/v1.html"))).toBe(false);
    expect(names.some((n) => n.endsWith("/meta.json"))).toBe(true);
    const metaName = names.find((n) => n.endsWith("/meta.json"))!;
    const meta = JSON.parse(strFromU8(entries[metaName]));
    expect(meta.included_versions).toEqual([]);
  });
});
