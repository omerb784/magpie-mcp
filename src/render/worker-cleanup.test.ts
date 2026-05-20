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

async function waitForRender(visualId: string, timeoutMs = 60_000): Promise<void> {
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
  tag: string;
  index: number;
  type: VisualType;
  ext: string;
  content: string;
}): { visualId: string } {
  const project = createProject(`h3-${args.tag}-${args.index}`, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `${args.tag} ${args.index}`,
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

const BAD_MERMAID = `not-a-valid-diagram-type\n  this is invalid mermaid syntax`;
const GOOD_HTML = `<!doctype html><html><body><p>good html</p></body></html>`;

describe("H3 · render-pool worker cleanup under interleaved good/bad burst", () => {
  it("20 jobs (10 good HTML + 10 bad mermaid interleaved) — pages return to baseline, no leak", async () => {
    if (!chromeAvailable) return;

    const browser = await getBrowser();
    const baselinePages = (await browser.pages()).length;

    const N = 10;
    const ids: { kind: "good" | "bad"; visualId: string }[] = [];
    for (let i = 0; i < N; i++) {
      const bad = enqueueWithContent({
        tag: "bad",
        index: i,
        type: "mermaid",
        ext: "mmd",
        content: BAD_MERMAID,
      });
      ids.push({ kind: "bad", visualId: bad.visualId });
      const good = enqueueWithContent({
        tag: "good",
        index: i,
        type: "html",
        ext: "html",
        content: GOOD_HTML,
      });
      ids.push({ kind: "good", visualId: good.visualId });
    }

    for (const { visualId } of ids) {
      await waitForRender(visualId, 60_000);
    }

    let okCount = 0;
    let failedCount = 0;
    for (const { kind, visualId } of ids) {
      const status = listForVisual(visualId)[0]!.render_status;
      if (kind === "good") {
        expect(status, `good[${visualId}] should be ok`).toBe("ok");
        if (status === "ok") okCount++;
      } else {
        expect(status, `bad[${visualId}] should be failed`).toBe("failed");
        if (status === "failed") failedCount++;
      }
    }
    expect(okCount).toBe(N);
    expect(failedCount).toBe(N);

    // Allow page-close in the failure path to settle.
    await new Promise((r) => setTimeout(r, 1000));
    const finalPages = (await browser.pages()).length;
    expect(
      finalPages,
      `page count grew (${baselinePages} -> ${finalPages}) — failed-job page-close leaked`,
    ).toBe(baselinePages);

    // Log the wall-cleanup snapshot for CI capture.
    // eslint-disable-next-line no-console
    console.error(
      `[H3 burst] N=${ids.length} ok=${okCount} failed=${failedCount} ` +
        `baselinePages=${baselinePages} finalPages=${finalPages}`,
    );
  }, 240_000);
});
