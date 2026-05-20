import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../config.js";

vi.mock("../../render/index.js", async () => {
  const versions = await vi.importActual<typeof import("../../store/versions.js")>(
    "../../store/versions.js"
  );
  return {
    enqueueRender: vi.fn((job: { version_id: string }) => {
      versions.setRenderStatus({
        version_id: job.version_id,
        status: "ok",
        thumb_path: null,
        error: null,
      });
    }),
    shutdownRender: vi.fn(async () => {}),
    thumbPath: (id: string, n: number) => `/tmp/${id}/v${n}.png`,
  };
});

vi.mock("../../http/ws.js", () => ({
  broadcast: vi.fn(),
  setupWs: vi.fn(),
}));

import { closeDb } from "../../store/db.js";
import { setResourcesListChangedNotifier } from "../notifications.js";
import type { Tool } from "../types.js";
import { addVisualTool } from "./add_visual.js";
import { archiveProjectTool } from "./archive_project.js";
import { archiveVisualTool } from "./archive_visual.js";
import { compareTool } from "./compare.js";
import { createProjectTool } from "./create_project.js";
import { findVisualsTool } from "./find_visuals.js";
import { iterateTool } from "./iterate.js";
import { listProjectsTool } from "./list_projects.js";
import { listVersionsTool } from "./list_versions.js";
import { mergeProjectsTool } from "./merge_projects.js";
import { openPreviewTool } from "./open_preview.js";
import { readInboxTool } from "./read_inbox.js";
import { updateProjectTool } from "./update_project.js";
import { updateVisualTool } from "./update_visual.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

async function call<T>(tool: Tool, args: T) {
  const parsed = tool.argsSchema.parse(args);
  return await tool.handler(parsed);
}

function text(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }) {
  const part = result.content[0];
  return part && "text" in part ? (part.text ?? "") : "";
}

async function seedVisual(project = "alpha") {
  const out = await call(addVisualTool, {
    project,
    type: "html",
    content: "<html><title>Hi</title></html>",
  });
  const id = text(out).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
  if (!id) throw new Error(`could not parse visual id from: ${text(out)}`);
  return id;
}

describe("create_project tool", () => {
  it("idempotent on duplicate name", async () => {
    const a = await call(createProjectTool, { name: "p", type: "mockup" });
    const b = await call(createProjectTool, { name: "p", type: "diagram" });
    expect(text(a)).toContain('Created project "p"');
    expect(text(b)).toContain('Reusing project "p"');
  });
});

describe("add_visual tool", () => {
  it("auto-creates project + saves v1", async () => {
    const r = await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>Page</title></html>",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Saved "Page" as visual [a-zA-Z0-9]+ v1 in project "alpha"\./);
    expect(text(r)).toContain("Preview:");
  });

  it("rejects content over 5MB", async () => {
    const big = "<html>" + "x".repeat(5 * 1024 * 1024 + 1) + "</html>";
    const r = await call(addVisualTool, { project: "p", type: "html", content: big });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("exceeds");
  });

  it("strips markdown fences", async () => {
    const r = await call(addVisualTool, {
      project: "p",
      type: "mermaid",
      content: "```mermaid\nflowchart LR\n  A --> B\n```",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("v1 in project");
  });

  it("accepts type='markdown' and extracts title from first H1", async () => {
    const r = await call(addVisualTool, {
      project: "docs",
      type: "markdown",
      content: "# Project Brief\n\nIntro paragraph.",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Saved "Project Brief" as visual [a-zA-Z0-9]+ v1 in project "docs"\./);
  });

  it("preserves fenced code blocks inside markdown content (does NOT strip)", async () => {
    const md = "# Spec\n\n```html\n<div>example</div>\n```";
    const r = await call(addVisualTool, {
      project: "docs",
      type: "markdown",
      content: md,
    });
    expect(r.isError).toBeFalsy();
    const id = text(r).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
  });

  it("accepts type='dot' and extracts title from digraph name", async () => {
    const r = await call(addVisualTool, {
      project: "graphs",
      type: "dot",
      content: "digraph PipelineFlow { a -> b -> c }",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Saved "PipelineFlow" as visual [a-zA-Z0-9]+ v1 in project "graphs"\./);
  });

  it("accepts type='vega-lite' and extracts title from spec.title", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: "Quarterly Revenue",
      data: {
        values: [
          { q: "Q1", r: 12 },
          { q: "Q2", r: 18 },
        ],
      },
      mark: "bar",
      encoding: {
        x: { field: "q", type: "nominal" },
        y: { field: "r", type: "quantitative" },
      },
    });
    const r = await call(addVisualTool, {
      project: "charts",
      type: "vega-lite",
      content: spec,
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(
      /Saved "Quarterly Revenue" as visual [a-zA-Z0-9]+ v1 in project "charts"\./
    );
  });

  it("accepts type='vega-lite' with title.text object form", async () => {
    const spec = JSON.stringify({
      title: { text: "Sales by Region" },
      data: { values: [{ a: 1 }] },
      mark: "point",
    });
    const r = await call(addVisualTool, {
      project: "charts",
      type: "vega-lite",
      content: spec,
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('"Sales by Region"');
  });

  it("accepts type='d2' and extracts title from top-level title key", async () => {
    const r = await call(addVisualTool, {
      project: "diagrams",
      type: "d2",
      content: 'title: "System Topology"\n\na -> b -> c',
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(
      /Saved "System Topology" as visual [a-zA-Z0-9]+ v1 in project "diagrams"\./
    );
  });

  it("accepts type='d2' without title and falls back to first line", async () => {
    const r = await call(addVisualTool, {
      project: "diagrams",
      type: "d2",
      content: "a -> b -> c",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("v1 in project");
  });
});

describe("iterate tool", () => {
  it("appends v2 + returns compare URL", async () => {
    const id = await seedVisual();
    const r = await call(iterateTool, {
      visual_id: id,
      content: "<html><title>Hi v2</title></html>",
      message: "darker",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
    expect(text(r)).toContain(`Compare v1 ↔ v2`);
  });

  it("rejects unknown visual_id", async () => {
    const r = await call(iterateTool, {
      visual_id: "ghost",
      content: "<html></html>",
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Unknown visual_id");
  });

  it("accepts optional description arg and persists to versions row (v0.9.2 Phase A)", async () => {
    const id = await seedVisual();
    const longDesc =
      "Reorganized for guide use. Sticky TOC, full R ledger grouped by theme, P de-emphasized to a dashed callout, hover-revealed anchor # on each card.";
    const r = await call(iterateTool, {
      visual_id: id,
      content: "<html><title>v2</title></html>",
      message: "guide rewrite",
      description: longDesc,
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);

    const { listForVisual } = await import("../../store/versions.js");
    const all = listForVisual(id);
    expect(all[1]?.description).toBe(longDesc);
    expect(all[1]?.message).toBe("guide rewrite");
  });

  it("rejects description over 2000 chars at the schema layer", () => {
    const r = iterateTool.argsSchema.safeParse({
      visual_id: "x",
      content: "<html></html>",
      description: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.code).toBe("too_big");
    expect(r.error.issues[0]?.path).toContain("description");
  });

  it("iterates a markdown visual to v2", async () => {
    const seed = await call(addVisualTool, {
      project: "docs",
      type: "markdown",
      content: "# Draft\n\nv1 body.",
    });
    const id = text(seed).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const r = await call(iterateTool, {
      visual_id: id!,
      content: "# Draft\n\nv2 body, expanded.",
      message: "expand intro",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
  });

  it("iterates a dot visual to v2", async () => {
    const seed = await call(addVisualTool, {
      project: "graphs",
      type: "dot",
      content: "digraph G { a -> b }",
    });
    const id = text(seed).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const r = await call(iterateTool, {
      visual_id: id!,
      content: "digraph G { a -> b -> c }",
      message: "added c",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
  });

  it("iterates a vega-lite visual to v2", async () => {
    const v1 = JSON.stringify({
      title: "Counts",
      data: { values: [{ a: "x", b: 1 }] },
      mark: "bar",
      encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
    });
    const seed = await call(addVisualTool, { project: "charts", type: "vega-lite", content: v1 });
    const id = text(seed).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const v2 = JSON.stringify({
      title: "Counts",
      data: { values: [{ a: "x", b: 1 }, { a: "y", b: 4 }] },
      mark: "bar",
      encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
    });
    const r = await call(iterateTool, { visual_id: id!, content: v2, message: "added y" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
  });

  it("iterates a d2 visual to v2", async () => {
    const seed = await call(addVisualTool, {
      project: "diagrams",
      type: "d2",
      content: "a -> b",
    });
    const id = text(seed).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const r = await call(iterateTool, {
      visual_id: id!,
      content: "a -> b -> c",
      message: "added c",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
  });
});

describe("content_path arg (R8)", () => {
  const SCRATCH = join(resolve(config.contentRoot), ".tmp-tools-content-path");

  beforeEach(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
  });

  afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("add_visual reads from content_path and saves v1", async () => {
    const p = join(SCRATCH, "page.html");
    writeFileSync(p, "<html><title>From Disk</title></html>", "utf8");
    const r = await call(addVisualTool, {
      project: "via-path",
      type: "html",
      content_path: p,
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Saved "From Disk" as visual [a-zA-Z0-9]+ v1 in project "via-path"\./);
  });

  it("iterate accepts content_path for v2", async () => {
    const p1 = join(SCRATCH, "v1.html");
    writeFileSync(p1, "<html><title>v1</title></html>", "utf8");
    const seed = await call(addVisualTool, {
      project: "via-path",
      type: "html",
      content_path: p1,
    });
    const id = text(seed).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const p2 = join(SCRATCH, "v2.html");
    writeFileSync(p2, "<html><title>v2</title></html>", "utf8");
    const r = await call(iterateTool, {
      visual_id: id!,
      content_path: p2,
      message: "from disk",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`(${id}) updated to v2`);
  });

  it("rejects when both content and content_path are provided", () => {
    const parsed = addVisualTool.argsSchema.safeParse({
      project: "p",
      type: "html",
      content: "<html></html>",
      content_path: join(SCRATCH, "anything.html"),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects when neither content nor content_path is provided", () => {
    const parsed = addVisualTool.argsSchema.safeParse({
      project: "p",
      type: "html",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects relative content_path", async () => {
    const r = await call(addVisualTool, {
      project: "p",
      type: "html",
      content_path: "./relative.html",
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("relative");
  });

  it("rejects content_path that resolves outside the content root", async () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/hosts";
    const r = await call(addVisualTool, {
      project: "p",
      type: "html",
      content_path: outside,
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/outside_root|not_found/);
  });

  it("rejects content_path larger than maxContentBytes", async () => {
    const p = join(SCRATCH, "fat.html");
    writeFileSync(p, "x".repeat(config.maxContentBytes + 1), "utf8");
    const r = await call(addVisualTool, {
      project: "p",
      type: "html",
      content_path: p,
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("too_big");
  });
});

describe("update_visual tool", () => {
  it("replaces tag set + toggles starred", async () => {
    const id = await seedVisual();
    const r = await call(updateVisualTool, {
      visual_id: id,
      title: "Renamed",
      tags: ["wip", "approved"],
      starred: true,
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Title: Renamed");
    expect(text(r)).toContain("★");
    expect(text(r)).toMatch(/Tags: (wip, approved|approved, wip)/);

    const cleared = await call(updateVisualTool, { visual_id: id, tags: [] });
    expect(text(cleared)).toContain("Tags: —");
  });

  it("rejects when no fields provided", async () => {
    const id = await seedVisual();
    const r = await call(updateVisualTool, { visual_id: id });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nothing to update");
  });

  it("rejects unknown visual_id", async () => {
    const r = await call(updateVisualTool, { visual_id: "ghost", title: "x" });
    expect(r.isError).toBe(true);
  });
});

describe("archive_visual tool", () => {
  it("archives + warns on second call", async () => {
    const id = await seedVisual();
    const r1 = await call(archiveVisualTool, { visual_id: id });
    expect(r1.isError).toBeFalsy();
    expect(text(r1)).toContain("Archived");

    const r2 = await call(archiveVisualTool, { visual_id: id });
    expect(r2.isError).toBeFalsy();
    expect(text(r2)).toContain("already archived");
  });

  it("rejects unknown visual_id", async () => {
    const r = await call(archiveVisualTool, { visual_id: "ghost" });
    expect(r.isError).toBe(true);
  });
});

describe("archive_project / update_project / merge_projects tools", () => {
  it("archive_project: missing returns error", async () => {
    const r = await call(archiveProjectTool, { name: "ghost" });
    expect(r.isError).toBe(true);
  });

  it("update_project: rename success + conflict", async () => {
    await seedVisual("alpha");
    await seedVisual("beta");
    const ok = await call(updateProjectTool, { old_name: "alpha", new_name: "gamma" });
    expect(ok.isError).toBeFalsy();
    expect(text(ok)).toContain('renamed → "gamma"');

    const conflict = await call(updateProjectTool, { old_name: "gamma", new_name: "beta" });
    expect(conflict.isError).toBe(true);
    expect(text(conflict)).toContain("already exists");
  });

  it("update_project: description-only update", async () => {
    await call(createProjectTool, { name: "alpha", type: "mockup" });
    const r = await call(updateProjectTool, {
      old_name: "alpha",
      description: "onboarding flows",
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("description updated");
  });

  it("update_project: rename + description in one call", async () => {
    await call(createProjectTool, { name: "alpha", type: "mockup" });
    const r = await call(updateProjectTool, {
      old_name: "alpha",
      new_name: "alpha2",
      description: "v2 of onboarding",
    });
    expect(text(r)).toContain('renamed → "alpha2"');
    expect(text(r)).toContain("description updated");
  });

  it("update_project: at-least-one rule rejects empty patch", async () => {
    await call(createProjectTool, { name: "alpha", type: "mockup" });
    const r = await (async () => {
      try {
        return await call(updateProjectTool, { old_name: "alpha" });
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: String(err) }] };
      }
    })();
    expect(r.isError).toBe(true);
  });

  it("update_project: no-op when supplied values match current", async () => {
    await call(createProjectTool, {
      name: "alpha",
      type: "mockup",
      description: "spec",
    });
    const r = await call(updateProjectTool, {
      old_name: "alpha",
      description: "spec",
    });
    expect(text(r)).toContain("(no change)");
  });

  it("update_project: description: null clears the field", async () => {
    await call(createProjectTool, {
      name: "alpha",
      type: "mockup",
      description: "spec",
    });
    const r = await call(updateProjectTool, {
      old_name: "alpha",
      description: null,
    });
    expect(text(r)).toContain("description cleared");
  });

  it("merge_projects: counts moved + archives src", async () => {
    await seedVisual("alpha");
    await seedVisual("alpha");
    await seedVisual("beta");
    const r = await call(mergeProjectsTool, { src_name: "alpha", dst_name: "beta" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Moved 2 visual(s)");
    expect(text(r)).toContain('"alpha" archived');
  });

  it("merge_projects: same name fails", async () => {
    await seedVisual("alpha");
    const r = await call(mergeProjectsTool, { src_name: "alpha", dst_name: "alpha" });
    expect(r.isError).toBe(true);
  });
});

describe("find_visuals tool", () => {
  it("returns text table when matches found", async () => {
    await seedVisual("alpha");
    const r = await call(findVisualsTool, { query: "Hi" });
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toContain("id");
    expect(out).toContain("title");
    expect(out).toContain("Hi");
  });

  it("inlines preview URL per row so callers skip the open_preview round-trip", async () => {
    const created = await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>UrlTest</title></html>",
    });
    const visualId = text(created).match(/visual ([A-Za-z0-9]+) v\d+/)?.[1];
    expect(visualId).toBeTruthy();
    const r = await call(findVisualsTool, { query: "UrlTest" });
    const out = text(r);
    expect(out).toContain("preview");
    expect(out).toMatch(new RegExp(`http://[^\\s]+/v/${visualId}`));
  });

  it("returns widen-filter hint when empty", async () => {
    const r = await call(findVisualsTool, { query: "nothing" });
    expect(text(r)).toContain("No matches.");
    expect(text(r)).toContain("Try dropping a tag/source/type filter");
  });

  it("filters by source", async () => {
    await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>Stitched</title></html>",
      source: "stitch",
    });
    await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>FromFigma</title></html>",
      source: "figma",
    });
    const r = await call(findVisualsTool, { source: "figma" });
    const out = text(r);
    expect(out).toContain("FromFigma");
    expect(out).not.toContain("Stitched");
  });

  it("AND-composes multiple tags", async () => {
    await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>both</title></html>",
      tags: ["wip", "dashboard"],
    });
    await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html><title>onlywip</title></html>",
      tags: ["wip"],
    });
    const r = await call(findVisualsTool, { tags: ["wip", "dashboard"] });
    const out = text(r);
    expect(out).toContain("both");
    expect(out).not.toContain("onlywip");
  });

  it("type filter accepts every supported visual type", async () => {
    const fixtures: Array<{
      type: "markdown" | "dot" | "vega-lite" | "d2";
      content: string;
      title: string;
    }> = [
      { type: "markdown", content: "# md-title", title: "md-title" },
      { type: "dot", content: "digraph G { a -> b }", title: "dot-graph" },
      {
        type: "vega-lite",
        content: JSON.stringify({
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          title: "vl-chart",
          data: { values: [{ x: 1 }] },
          mark: "point",
          encoding: { x: { field: "x", type: "quantitative" } },
        }),
        title: "vl-chart",
      },
      { type: "d2", content: "x -> y", title: "d2-graph" },
    ];
    for (const f of fixtures) {
      await call(addVisualTool, {
        project: "alpha",
        type: f.type,
        content: f.content,
        title: f.title,
      });
    }
    for (const f of fixtures) {
      const r = await call(findVisualsTool, { type: f.type });
      expect(r.isError, `find_visuals errored for type=${f.type}`).toBeFalsy();
      const out = text(r);
      expect(out, `find_visuals dropped type=${f.type}`).toContain(f.title);
    }
  });
});

describe("compare + open_preview tools", () => {
  it("compare returns URL after iterate", async () => {
    const id = await seedVisual();
    await call(iterateTool, { visual_id: id, content: "<html></html>" });
    const r = await call(compareTool, { visual_id: id });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`/compare/${id}?a=1&b=2`);
  });

  it("compare: a == b is rejected", async () => {
    const id = await seedVisual();
    await call(iterateTool, { visual_id: id, content: "<html></html>" });
    const r = await call(compareTool, { visual_id: id, a: 1, b: 1 });
    expect(r.isError).toBe(true);
  });

  it("compare: missing version is rejected", async () => {
    const id = await seedVisual();
    const r = await call(compareTool, { visual_id: id, a: 1, b: 99 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Version 99 not found");
  });

  it("open_preview: default surface is the library deep-link (?visual=)", async () => {
    const id = await seedVisual();
    const r = await call(openPreviewTool, { visual_id: id });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(`/?visual=${id}`);
    expect(text(r)).not.toContain(`/v/${id}`);
    expect(text(r)).not.toContain("?ver=");
  });

  it("open_preview: explicit version switches to /v/:id?ver= (preview chrome)", async () => {
    const id = await seedVisual();
    await call(iterateTool, { visual_id: id, content: "<html></html>" });
    const r = await call(openPreviewTool, { visual_id: id, version: 1 });
    expect(text(r)).toContain(`/v/${id}?ver=1`);
    expect(text(r)).not.toContain(`?visual=${id}`);
  });

  it("open_preview: missing version fails", async () => {
    const id = await seedVisual();
    const r = await call(openPreviewTool, { visual_id: id, version: 99 });
    expect(r.isError).toBe(true);
  });
});

describe("list_projects + list_versions tools", () => {
  it("list_projects: empty hint", async () => {
    const r = await call(listProjectsTool, {});
    expect(text(r)).toContain("No projects yet");
  });

  it("list_projects: shows names + type + counts", async () => {
    await seedVisual("alpha");
    await seedVisual("alpha");
    const r = await call(listProjectsTool, {});
    expect(text(r)).toContain("alpha");
    expect(text(r)).toMatch(/alpha\s+mockup\s+2/);
    expect(text(r)).toContain("type");
  });

  it("list_versions: missing visual returns error result", async () => {
    const r = await call(listVersionsTool, { visual_id: "ghost" });
    expect(r.isError).toBe(true);
  });

  it("list_versions: lists v1..vN with messages", async () => {
    const id = await seedVisual();
    await call(iterateTool, { visual_id: id, content: "<html></html>", message: "darker" });
    const r = await call(listVersionsTool, { visual_id: id });
    expect(text(r)).toContain("ver");
    expect(text(r)).toContain("darker");
  });
});

describe("resources/list_changed notifier wiring (P2)", () => {
  function withSpy() {
    const spy = vi.fn();
    setResourcesListChangedNotifier(spy);
    return spy;
  }

  afterAll(() => {
    setResourcesListChangedNotifier(() => {});
  });

  it("add_visual fires notifier on every save (new + existing project)", async () => {
    const spy = withSpy();
    await call(addVisualTool, { project: "alpha", type: "html", content: "<html></html>" });
    expect(spy).toHaveBeenCalledTimes(1);
    await call(addVisualTool, { project: "alpha", type: "html", content: "<html></html>" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("iterate fires notifier", async () => {
    const id = await seedVisual();
    const spy = withSpy();
    await call(iterateTool, { visual_id: id, content: "<html></html>" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("update_visual fires notifier on real mutation", async () => {
    const id = await seedVisual();
    const spy = withSpy();
    await call(updateVisualTool, { visual_id: id, title: "Renamed" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("update_visual does NOT fire notifier on no-op (no fields)", async () => {
    const id = await seedVisual();
    const spy = withSpy();
    const r = await call(updateVisualTool, { visual_id: id });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("archive_visual fires notifier on archive, skips on already-archived", async () => {
    const id = await seedVisual();
    const spy = withSpy();
    await call(archiveVisualTool, { visual_id: id });
    expect(spy).toHaveBeenCalledTimes(1);
    await call(archiveVisualTool, { visual_id: id });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("P4 per-tool gap fixes", () => {
  it("add_visual: svg derives project type 'mixed'", async () => {
    await call(addVisualTool, {
      project: "icons",
      type: "svg",
      content: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    });
    const r = await call(listProjectsTool, {});
    expect(text(r)).toMatch(/icons\s+mixed/);
  });

  it("iterate: response always contains Compare line (next is always >= 2)", async () => {
    const id = await seedVisual();
    const r = await call(iterateTool, { visual_id: id, content: "<html></html>" });
    expect(text(r)).toMatch(/Compare v1 ↔ v2:/);
  });

  it("find_visuals: prepends deprecation note when tag (singular) used", async () => {
    await seedVisual("alpha");
    const r = await call(findVisualsTool, { tag: "wip" });
    expect(text(r)).toContain("`tag` (singular) is deprecated");
    expect(text(r)).toContain('tags: ["wip"]');
  });

  it("find_visuals: no deprecation note when tags (plural) used", async () => {
    await seedVisual("alpha");
    const r = await call(findVisualsTool, { tags: ["wip"] });
    expect(text(r)).not.toContain("deprecated");
  });

  it("update_visual: '(no change)' suffix when patch is identical to current", async () => {
    const id = await seedVisual();
    await call(updateVisualTool, { visual_id: id, title: "Renamed" });
    const r = await call(updateVisualTool, { visual_id: id, title: "Renamed" });
    expect(text(r)).toContain("(no change)");
  });

  it("update_visual: no '(no change)' suffix when something actually changed", async () => {
    const id = await seedVisual();
    const r = await call(updateVisualTool, { visual_id: id, title: "Renamed" });
    expect(text(r)).not.toContain("(no change)");
  });

  it("archive_visual: already-archived response includes restore hint", async () => {
    const id = await seedVisual();
    await call(archiveVisualTool, { visual_id: id });
    const r = await call(archiveVisualTool, { visual_id: id });
    expect(text(r)).toContain("already archived");
    expect(text(r)).toContain("Show archived");
    expect(r.isError).toBeFalsy();
  });
});

describe("P9 description column", () => {
  it("create_project: persists description and returns it via resource later", async () => {
    const r = await call(createProjectTool, {
      name: "alpha",
      type: "mockup",
      description: "first pass onboarding screens",
    });
    expect(text(r)).toContain("Created project");
    // Description doesn't have to show in create response, but must persist.
  });

  it("add_visual: accepts description; surfaces it via update_visual response on no-op", async () => {
    const r = await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html></html>",
      description: "hero panel dark variant",
    });
    const id = text(r).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    const u = await call(updateVisualTool, { visual_id: id!, title: "Hi" });
    expect(text(u)).toContain("Description: hero panel dark variant");
  });

  it("update_visual: edits description and surfaces in response", async () => {
    const id = await seedVisual();
    const r = await call(updateVisualTool, {
      visual_id: id,
      description: "tightened spec",
    });
    expect(text(r)).toContain("Description: tightened spec");
  });

  it("update_visual: description: null clears the field", async () => {
    const id = await seedVisual();
    await call(updateVisualTool, { visual_id: id, description: "x" });
    const r = await call(updateVisualTool, { visual_id: id, description: null });
    expect(text(r)).toMatch(/Description: —/);
  });

  it("update_visual: description-only patch with same value yields '(no change)'", async () => {
    const id = await seedVisual();
    await call(updateVisualTool, { visual_id: id, description: "spec" });
    const r = await call(updateVisualTool, { visual_id: id, description: "spec" });
    expect(text(r)).toContain("(no change)");
  });

  it("find_visuals: match_description=true searches title OR description", async () => {
    await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html></html>",
      title: "Hero",
      description: "checkout funnel revamp draft",
    });
    const titleOnly = await call(findVisualsTool, { query: "checkout" });
    expect(text(titleOnly)).toContain("No matches");

    const both = await call(findVisualsTool, {
      query: "checkout",
      match_description: true,
    });
    expect(text(both)).toContain("Hero");
  });
});

describe("P10 Magpie ref line", () => {
  it("add_visual response includes 'Magpie ref: magpie://visual/<id>'", async () => {
    const r = await call(addVisualTool, {
      project: "alpha",
      type: "html",
      content: "<html></html>",
    });
    const id = text(r).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id).toBeTruthy();
    expect(text(r)).toContain(`Magpie ref: magpie://visual/${id}`);
  });

  it("iterate response includes 'Magpie ref: magpie://visual/<id>'", async () => {
    const id = await seedVisual();
    const r = await call(iterateTool, { visual_id: id, content: "<html></html>" });
    expect(text(r)).toContain(`Magpie ref: magpie://visual/${id}`);
  });
});

describe("read_inbox tool (P1.C)", () => {
  async function sendToInbox(visual_id?: string, body = "Test prompt") {
    const { insertInbox } = await import("../../store/inbox.js");
    return insertInbox({ visual_id, prompt_body: body });
  }

  it("returns 'Inbox empty' when nothing pending", async () => {
    const r = await call(readInboxTool, {});
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Inbox empty");
  });

  it("returns pending entries oldest-first and marks them consumed", async () => {
    const id = await seedVisual();
    const e1 = await sendToInbox(id, "First prompt");
    const e2 = await sendToInbox(id, "Second prompt");

    const r = await call(readInboxTool, {});
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toContain("2 pending entries");
    expect(out).toContain(e1.id);
    expect(out).toContain(e2.id);
    expect(out).toContain("First prompt");
    expect(out).toContain("Second prompt");
    expect(out.indexOf(e1.id)).toBeLessThan(out.indexOf(e2.id));
    expect(out).toContain(`Magpie ref: magpie://visual/${id}`);

    const followUp = await call(readInboxTool, {});
    expect(text(followUp)).toContain("Inbox empty");
  });

  it("count caps how many entries come back; rest stay pending", async () => {
    const id = await seedVisual();
    await sendToInbox(id, "A");
    await sendToInbox(id, "B");
    await sendToInbox(id, "C");

    const r = await call(readInboxTool, { count: 2 });
    expect(text(r)).toContain("2 pending entries");

    const next = await call(readInboxTool, {});
    expect(text(next)).toContain("1 pending entry");
    expect(text(next)).not.toContain("entryies");
  });

  it("id arg fetches one specific entry + marks consumed", async () => {
    const id = await seedVisual();
    const e = await sendToInbox(id, "specific");
    const r = await call(readInboxTool, { id: e.id });
    expect(text(r)).toContain(e.id);
    expect(text(r)).toContain("specific");
    const next = await call(readInboxTool, { id: e.id });
    expect(text(next)).toContain("already consumed");
    expect(next.isError).toBeFalsy();
  });

  it("id arg on unknown id returns isError", async () => {
    const r = await call(readInboxTool, { id: "missing_xyz" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("not found");
  });

  it("renders free-form entries (no visual_id) without Magpie ref line", async () => {
    const e = await sendToInbox(undefined, "free form");
    const r = await call(readInboxTool, {});
    const out = text(r);
    expect(out).toContain(e.id);
    expect(out).toContain("free-form send");
    expect(out).not.toContain("Magpie ref:");
  });

  it("fires resources/list_changed only when something is consumed", async () => {
    const id = await seedVisual();
    const notify = vi.fn();
    setResourcesListChangedNotifier(notify);

    await call(readInboxTool, {});
    expect(notify).not.toHaveBeenCalled();

    await sendToInbox(id, "x");
    await call(readInboxTool, {});
    expect(notify).toHaveBeenCalled();
  });
});
