import { existsSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { createProject } from "../store/projects.js";
import { createVisual, type VisualType } from "../store/visuals.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { closeBrowser, getBrowser } from "./browser.js";
import { enqueueRender, shutdownRender } from "./index.js";

const GOLDENS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "render-goldens",
);

interface Golden {
  type: VisualType;
  file: string;
  /** Min thumb byte floor below which we consider the render blank. */
  bytesFloor: number;
}

const GOLDENS: Golden[] = [
  { type: "html", file: "html.html", bytesFloor: 200 },
  { type: "mermaid", file: "mermaid.mmd", bytesFloor: 800 },
  { type: "svg", file: "svg.svg", bytesFloor: 200 },
  { type: "markdown", file: "markdown.md", bytesFloor: 500 },
  { type: "dot", file: "dot.dot", bytesFloor: 500 },
  { type: "vega-lite", file: "vega-lite.json", bytesFloor: 500 },
  { type: "d2", file: "d2.d2", bytesFloor: 500 },
];

let httpHandle: HttpHandle | null = null;
let chromeAvailable = false;

beforeAll(async () => {
  try {
    await getBrowser();
    chromeAvailable = true;
  } catch {
    chromeAvailable = false;
    return;
  }
  httpHandle = await startHttpServer();
}, 60_000);

afterAll(async () => {
  await shutdownRender();
  if (httpHandle) {
    await httpHandle.close();
    httpHandle = null;
  }
  await closeBrowser();
  closeDb();
}, 30_000);

async function waitForRender(visualId: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const versions = listForVisual(visualId);
    const v = versions[0];
    if (v && v.render_status !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`render did not complete within ${timeoutMs}ms for ${visualId}`);
}

function setupVisualForGolden(g: Golden, index: number): {
  visualId: string;
  blobPath: string;
} {
  const project = createProject(`f1-golden-${g.type}-${index}`, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `golden ${g.type}`,
    type: g.type,
    source: null,
  });
  const home = process.env.MAGPIE_HOME!;
  const ext = g.file.split(".").pop() ?? "txt";
  const blobDir = join(home, "blobs", visual.id);
  mkdirSync(blobDir, { recursive: true });
  const blobPath = join(blobDir, `v1.${ext}`);
  copyFileSync(join(GOLDENS_DIR, g.file), blobPath);
  const version = appendVersion({
    visual_id: visual.id,
    version_num: 1,
    content_path: blobPath,
    message: null,
  });
  enqueueRender({
    visual_id: visual.id,
    version_id: version.id,
    version_num: 1,
    type: g.type,
    content_path: blobPath,
  });
  return { visualId: visual.id, blobPath };
}

describe("F1 · per-format correctness · 7 goldens", () => {
  it("golden fixture files exist on disk", () => {
    for (const g of GOLDENS) {
      const path = join(GOLDENS_DIR, g.file);
      expect(existsSync(path), `missing fixture ${g.file}`).toBe(true);
    }
  });

  for (const g of GOLDENS) {
    it(`renders ${g.type} to a thumb above the ${g.bytesFloor}-byte floor`, async () => {
      if (!chromeAvailable) return;
      const { visualId } = setupVisualForGolden(g, GOLDENS.indexOf(g));
      await waitForRender(visualId, 45_000);
      const versions = listForVisual(visualId);
      const v = versions[0]!;
      expect(v.render_status, `expected ok, error: ${v.render_error}`).toBe("ok");
      expect(v.thumb_path).not.toBeNull();
      const thumbPath = v.thumb_path!;
      expect(existsSync(thumbPath), `thumb file missing at ${thumbPath}`).toBe(true);
      const bytes = statSync(thumbPath).size;
      expect(bytes, `thumb bytes ${bytes} below floor ${g.bytesFloor}`).toBeGreaterThan(g.bytesFloor);
    }, 60_000);
  }
});
