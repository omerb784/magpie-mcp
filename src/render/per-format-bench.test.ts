import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { closeDb } from "../store/db.js";
import { createProject } from "../store/projects.js";
import { createVisual, type VisualType } from "../store/visuals.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { closeBrowser, getBrowser } from "./browser.js";
import { enqueueRender, shutdownRender } from "./index.js";

// v0.9.2 Phase J / J2 — per-format render p50/p99 + heap-delta.
//
// Reuses the Phase F golden fixtures (`test/fixtures/render-goldens/`) so
// every format has a real Owner-shaped payload, not a degenerate stub.
//
// SAMPLES_PER_FORMAT = 5 keeps wall under the suite budget. F3 measured
// html at 1.66 s/job serial; 7 formats × 6 renders (warmup + 5 samples)
// ~= 70 s wall on dev laptop with single-page lifecycle overhead.
//
// Per Decision i (Owner walkthrough): report-only. No hard p99 budget
// asserted; this test logs a comparison table for audit-08-perf.md § J2.
// Only the catastrophic floor is checked: every format must successfully
// render to status=ok (zero failures across the bench).

const GOLDENS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "render-goldens",
);

const SAMPLES_PER_FORMAT = 5;

interface Fmt {
  type: VisualType;
  file: string;
}

const FORMATS: Fmt[] = [
  { type: "html", file: "html.html" },
  { type: "mermaid", file: "mermaid.mmd" },
  { type: "svg", file: "svg.svg" },
  { type: "markdown", file: "markdown.md" },
  { type: "dot", file: "dot.dot" },
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

async function waitForRender(visualId: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const versions = listForVisual(visualId);
    const v = versions[0];
    if (v && v.render_status !== "pending") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`render did not complete within ${timeoutMs}ms for ${visualId}`);
}

function enqueueOne(fmt: Fmt, projectName: string): { visualId: string } {
  const project = createProject(projectName, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `j2-${fmt.type}`,
    type: fmt.type,
    source: null,
  });
  const home = process.env.MAGPIE_HOME!;
  const ext = fmt.file.split(".").pop() ?? "txt";
  const blobDir = join(home, "blobs", visual.id);
  mkdirSync(blobDir, { recursive: true });
  const blobPath = join(blobDir, `v1.${ext}`);
  copyFileSync(join(GOLDENS_DIR, fmt.file), blobPath);
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
    type: fmt.type,
    content_path: blobPath,
  });
  return { visualId: visual.id };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.floor(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, idx)]!;
}

describe("J2 · per-format render p50/p99", () => {
  it(`measures wall + heap-delta across ${FORMATS.length} formats × ${SAMPLES_PER_FORMAT} samples`, async () => {
    if (!chromeAvailable) return;

    const summary: Array<{
      format: VisualType;
      p50_ms: number;
      p99_ms: number;
      max_ms: number;
      heap_delta_mb_max: number;
      warmup_ms: number;
    }> = [];

    let runCounter = 0;
    for (const fmt of FORMATS) {
      const samples: number[] = [];
      const heapDeltas: number[] = [];

      // Warmup — first render per format pays per-format module load
      // (mermaid JS injection, viz.js for dot, vega-lite renderer, d2 wasm).
      // Drop from p99 computation.
      const wT0 = Date.now();
      const warm = enqueueOne(fmt, `j2-warm-${fmt.type}-${runCounter++}`);
      await waitForRender(warm.visualId, 60_000);
      const warmupMs = Date.now() - wT0;

      for (let i = 0; i < SAMPLES_PER_FORMAT; i++) {
        const heapBefore = process.memoryUsage().heapUsed;
        const t0 = Date.now();
        const sample = enqueueOne(fmt, `j2-${fmt.type}-${runCounter++}`);
        await waitForRender(sample.visualId, 60_000);
        const wall = Date.now() - t0;
        const heapAfter = process.memoryUsage().heapUsed;

        const versions = listForVisual(sample.visualId);
        expect(
          versions[0]?.render_status,
          `${fmt.type} sample ${i} failed: ${versions[0]?.render_error}`,
        ).toBe("ok");

        samples.push(wall);
        heapDeltas.push((heapAfter - heapBefore) / (1024 * 1024));
      }

      const sortedSamples = [...samples].sort((a, b) => a - b);
      const sortedHeap = [...heapDeltas].sort((a, b) => a - b);
      summary.push({
        format: fmt.type,
        p50_ms: percentile(sortedSamples, 0.5),
        p99_ms: percentile(sortedSamples, 0.99),
        max_ms: sortedSamples[sortedSamples.length - 1]!,
        heap_delta_mb_max: Number(sortedHeap[sortedHeap.length - 1]!.toFixed(2)),
        warmup_ms: warmupMs,
      });
    }

    // Emit comparison table — picked up by audit-08-perf.md § J2.
    const htmlBase = summary.find((r) => r.format === "html");
    const rows = summary
      .map((r) => {
        const ratio = htmlBase ? (r.p99_ms / htmlBase.p99_ms).toFixed(2) : "-";
        return `[J2] ${r.format.padEnd(10)} warmup=${String(r.warmup_ms).padStart(5)} ms · p50=${String(r.p50_ms).padStart(5)} ms · p99=${String(r.p99_ms).padStart(5)} ms · max=${String(r.max_ms).padStart(5)} ms · ratio-to-html=${ratio}× · heap-delta-max=${r.heap_delta_mb_max} MB`;
      })
      .join("\n");
    // eslint-disable-next-line no-console
    console.error("\n" + rows + "\n");

    // Catastrophic-floor assertions only (per Decision i: report-only).
    for (const r of summary) {
      expect(r.p99_ms, `${r.format} p99 ${r.p99_ms} ms > 10000 ms catastrophic floor`).toBeLessThan(
        10_000,
      );
    }
  }, 600_000);
});
