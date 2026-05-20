import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { createProject } from "../store/projects.js";
import { createVisual, type VisualType } from "../store/visuals.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { closeBrowser, getBrowser } from "./browser.js";
import { enqueueRender, shutdownRender } from "./index.js";

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

function enqueueWithContent(args: {
  index: number;
  type: VisualType;
  ext: string;
  content: string;
}): { visualId: string } {
  const project = createProject(`f2-iso-${args.type}-${args.index}`, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `iso ${args.type}`,
    type: args.type,
    source: null,
  });
  const home = process.env.MAGPIE_HOME!;
  const blobDir = join(home, "blobs", visual.id);
  mkdirSync(blobDir, { recursive: true });
  const blobPath = join(blobDir, `v1.${args.ext}`);
  writeFileSync(blobPath, args.content);
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
    type: args.type,
    content_path: blobPath,
  });
  return { visualId: visual.id };
}

// Mermaid source whose first line cannot be parsed by mermaid — guarantees
// renderByType throws on the `dataset.mermaidReady === "error"` branch.
// Mirrors a real-world malformed Claude output that would land in the queue.
const BAD_MERMAID = `not-a-valid-diagram-type\n  this is invalid mermaid syntax`;

const GOOD_HTML = `<!doctype html><html><body><p>good html</p></body></html>`;
const GOOD_MERMAID = `flowchart TD
  A[ok] --> B[ok]`;

describe("F2 · render failure isolation · neighbors keep draining", () => {
  it("bad-mermaid -> good-html -> good-mermaid: first fails, next two render ok", async () => {
    if (!chromeAvailable) return;

    const browser = await getBrowser();
    const baselinePages = (await browser.pages()).length;

    const bad = enqueueWithContent({
      index: 0,
      type: "mermaid",
      ext: "mmd",
      content: BAD_MERMAID,
    });
    const goodA = enqueueWithContent({
      index: 1,
      type: "html",
      ext: "html",
      content: GOOD_HTML,
    });
    const goodB = enqueueWithContent({
      index: 2,
      type: "mermaid",
      ext: "mmd",
      content: GOOD_MERMAID,
    });

    await waitForRender(bad.visualId, 30_000);
    await waitForRender(goodA.visualId, 30_000);
    await waitForRender(goodB.visualId, 30_000);

    const badStatus = listForVisual(bad.visualId)[0]!.render_status;
    const goodAStatus = listForVisual(goodA.visualId)[0]!.render_status;
    const goodBStatus = listForVisual(goodB.visualId)[0]!.render_status;

    expect(badStatus, "bad mermaid should have failed").toBe("failed");
    expect(goodAStatus, "good html after a failure should render ok").toBe("ok");
    expect(goodBStatus, "good mermaid after a failure should render ok").toBe("ok");

    // No page leak — every job closes its page in finally. Allow a small
    // grace window for the bad-mermaid page to finish closing.
    await new Promise((r) => setTimeout(r, 500));
    const finalPages = (await browser.pages()).length;
    expect(
      finalPages,
      `page count grew (${baselinePages} -> ${finalPages}) — page-close leaked`,
    ).toBe(baselinePages);
  }, 120_000);
});
