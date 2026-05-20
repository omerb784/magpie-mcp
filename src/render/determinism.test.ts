import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
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
}

const GOLDENS: Golden[] = [
  { type: "html", file: "html.html" },
  { type: "svg", file: "svg.svg" },
  { type: "markdown", file: "markdown.md" },
  { type: "dot", file: "dot.dot" },
  { type: "mermaid", file: "mermaid.mmd" },
  { type: "vega-lite", file: "vega-lite.json" },
  { type: "d2", file: "d2.d2" },
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

async function waitForRender(visualId: string, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const versions = listForVisual(visualId);
    const v = versions[0];
    if (v && v.render_status !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`render did not complete within ${timeoutMs}ms for ${visualId}`);
}

async function renderAndHash(g: Golden, label: string): Promise<string> {
  const project = createProject(`f4-det-${g.type}-${label}-${Date.now()}`, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `det ${g.type} ${label}`,
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
  await waitForRender(visual.id);
  const v = listForVisual(visual.id)[0]!;
  expect(v.render_status, `render failed for ${g.type} ${label}: ${v.render_error}`).toBe("ok");
  const bytes = readFileSync(v.thumb_path!);
  return createHash("sha256").update(bytes).digest("hex");
}

describe("F4 · per-format determinism · double-render PNG hash", () => {
  for (const g of GOLDENS) {
    it(`${g.type} hashes equal across two independent renders`, async () => {
      if (!chromeAvailable) return;
      const hashA = await renderAndHash(g, "a");
      const hashB = await renderAndHash(g, "b");
      // eslint-disable-next-line no-console
      console.error(`[F4 det] ${g.type} hashA=${hashA.slice(0, 12)} hashB=${hashB.slice(0, 12)} match=${hashA === hashB}`);
      expect(hashA, `${g.type} double-render produced different PNGs`).toBe(hashB);
    }, 120_000);
  }
});
