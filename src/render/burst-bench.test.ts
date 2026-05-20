import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { createProject } from "../store/projects.js";
import { createVisual } from "../store/visuals.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { closeBrowser, getBrowser } from "./browser.js";
import { enqueueRender, shutdownRender } from "./index.js";

const BURST = 10;
const GOOD_HTML = `<!doctype html><html><body><p>burst test</p></body></html>`;
// Soft p95 ceiling per scope mock: 60 s for 10 trivial jobs.
const WALL_CEILING_MS = 60_000;

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

async function waitForAll(visualIds: string[], timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const allDone = visualIds.every((id) => {
      const v = listForVisual(id)[0];
      return v && v.render_status !== "pending";
    });
    if (allDone) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`burst did not drain within ${timeoutMs}ms`);
}

describe("F3 · queue throughput under burst · serial baseline probe", () => {
  it(`drains ${BURST} simultaneous good-html enqueues with all status=ok`, async () => {
    if (!chromeAvailable) return;

    const visualIds: string[] = [];
    const enqueueStarts: number[] = [];
    const home = process.env.MAGPIE_HOME!;

    for (let i = 0; i < BURST; i++) {
      const project = createProject(`f3-burst-${i}`, "mockup");
      const visual = createVisual({
        project_id: project.id,
        title: `burst ${i}`,
        type: "html",
        source: null,
      });
      const blobDir = join(home, "blobs", visual.id);
      mkdirSync(blobDir, { recursive: true });
      const blobPath = join(blobDir, "v1.html");
      writeFileSync(blobPath, GOOD_HTML);
      const version = appendVersion({
        visual_id: visual.id,
        version_num: 1,
        content_path: blobPath,
        message: null,
      });
      enqueueStarts.push(Date.now());
      enqueueRender({
        visual_id: visual.id,
        version_id: version.id,
        version_num: 1,
        type: "html",
        content_path: blobPath,
      });
      visualIds.push(visual.id);
    }

    const burstStart = enqueueStarts[0]!;
    await waitForAll(visualIds, WALL_CEILING_MS + 30_000);
    const wallMs = Date.now() - burstStart;

    const okCount = visualIds.filter(
      (id) => listForVisual(id)[0]?.render_status === "ok",
    ).length;

    // Surface throughput shape to vitest stderr — CI flushes into
    // $GITHUB_STEP_SUMMARY via reporter capture.
    const perJobMs = Math.round(wallMs / BURST);
    // eslint-disable-next-line no-console
    console.error(
      `[F3 burst] N=${BURST} wall=${wallMs}ms perJob~${perJobMs}ms ok=${okCount}/${BURST}`,
    );

    const browser = await getBrowser();
    const procInfo = browser.process();
    // eslint-disable-next-line no-console
    console.error(`[F3 burst] browser pid=${procInfo?.pid ?? "unknown"} pages=${(await browser.pages()).length}`);

    expect(okCount, `expected all ${BURST} jobs to succeed`).toBe(BURST);
    // Soft ceiling — under serial-queue baseline ~ N × per-job render time.
    // Failing this points at v0.9.3 parallel-worker hopper (carved out).
    expect(wallMs, `burst wall ${wallMs}ms exceeded soft ceiling ${WALL_CEILING_MS}ms`)
      .toBeLessThan(WALL_CEILING_MS);
  }, 120_000);
});
