import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "puppeteer-core";
import { config } from "../config.js";
import { broadcast } from "../http/ws.js";
import { getBaseUrl } from "../runtime.js";
import { setRenderStatus } from "../store/versions.js";
import type { VisualType } from "../store/visuals.js";
import { closeBrowser, getBrowser } from "./browser.js";
import { d2PreviewHtml, d2ToSvg } from "./d2.js";
import { dotPreviewHtml, dotToSvg } from "./dot.js";
import { markdownToHtml } from "./markdown.js";
import { vegaLitePreviewHtml, vegaLiteToSvg } from "./vegalite.js";

export interface RenderJob {
  visual_id: string;
  version_id: string;
  version_num: number;
  type: VisualType;
  content_path: string;
}

const queue: RenderJob[] = [];
let processing = false;

export function enqueueRender(job: RenderJob): void {
  queue.push(job);
  if (!processing) void drain();
}

export async function shutdownRender(): Promise<void> {
  queue.length = 0;
  await closeBrowser();
}

export function thumbPath(visual_id: string, version_num: number): string {
  return join(config.blobsRoot, visual_id, `v${version_num}.png`);
}

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      await runJob(job);
    }
  } finally {
    processing = false;
  }
}

export function isBrowserDisconnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Target closed") ||
    msg.includes("Protocol error") ||
    msg.includes("Connection closed") ||
    msg.includes("Browser closed") ||
    msg.includes("browser has disconnected") ||
    msg.includes("Session closed") ||
    // v0.9.3 Phase A — also retry on spawn-fail patterns. The shared
    // userDataDir can leave a stale SingletonLock when Chrome dies hard
    // (Windows sleep-wake, OOM, Defender kill); the next puppeteer.launch()
    // surfaces "Failed to launch the browser process! undefined" with
    // stderr empty. browser.ts's clearStaleSingletons() removes the lock
    // on retry, so promoting these patterns to the disconnect bucket lets
    // the existing one-retry budget recover instead of failing the job.
    msg.includes("Failed to launch the browser process") ||
    msg.includes("ProcessSingleton") ||
    msg.includes("SingletonLock")
  );
}

async function runJob(job: RenderJob): Promise<void> {
  let lastErr: unknown = null;
  // v0.9.2 Phase F · Decision ii — auto-restart browser on dead handle.
  // One retry budget per job. If the first attempt fails with a Chrome /
  // CDP disconnect-shaped error, force the cached browser singleton to
  // be replaced (`closeBrowser()` clears the in-memory ref + Chrome's
  // already-dead, the close is best-effort) and retry once. getBrowser()
  // on the retry path will re-launch a fresh Chrome.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await runJobOnce(job);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isBrowserDisconnectError(err)) {
        await closeBrowser().catch(() => {});
        continue;
      }
      break;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  setRenderStatus({
    version_id: job.version_id,
    status: "failed",
    thumb_path: null,
    error: msg,
  });
  broadcast({
    kind: "version.rendered",
    visual_id: job.visual_id,
    version_num: job.version_num,
    status: "failed",
    thumb_path: null,
  });
  console.error(`[render] ${job.visual_id} v${job.version_num} failed:`, msg);
}

async function runJobOnce(job: RenderJob): Promise<void> {
  let page: Page | null = null;
  try {
    const content = readFileSync(job.content_path, "utf8");
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport(config.viewport);
    await renderByType(page, job.type, content);
    const out = thumbPath(job.visual_id, job.version_num);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: "png", fullPage: false });
    setRenderStatus({
      version_id: job.version_id,
      status: "ok",
      thumb_path: out,
      error: null,
    });
    broadcast({
      kind: "version.rendered",
      visual_id: job.visual_id,
      version_num: job.version_num,
      status: "ok",
      thumb_path: out,
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore — page may already be gone if browser crashed.
      }
    }
  }
}

async function renderByType(page: Page, type: VisualType, content: string): Promise<void> {
  if (type === "html") {
    await page.setContent(content, { waitUntil: "networkidle0", timeout: config.renderTimeoutMs });
    return;
  }
  if (type === "svg") {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}svg{display:block;max-width:100vw;max-height:100vh;margin:0 auto}</style></head><body>${content}</body></html>`;
    await page.setContent(html, { waitUntil: "load", timeout: config.renderTimeoutMs });
    return;
  }
  if (type === "mermaid") {
    await page.setContent(mermaidShell(content), {
      waitUntil: "networkidle0",
      timeout: config.renderTimeoutMs,
    });
    await page.waitForFunction(
      'document.body.dataset.mermaidReady === "true" || document.body.dataset.mermaidReady === "error"',
      { timeout: config.renderTimeoutMs }
    );
    const state = (await page.evaluate("document.body.dataset.mermaidReady")) as string;
    if (state === "error") throw new Error("mermaid render failed");
    return;
  }
  if (type === "markdown") {
    await page.setContent(markdownToHtml(content), {
      waitUntil: "load",
      timeout: config.renderTimeoutMs,
    });
    return;
  }
  if (type === "dot") {
    const svg = await dotToSvg(content);
    await page.setContent(dotPreviewHtml(svg), {
      waitUntil: "load",
      timeout: config.renderTimeoutMs,
    });
    return;
  }
  if (type === "vega-lite") {
    const svg = await vegaLiteToSvg(content);
    await page.setContent(vegaLitePreviewHtml(svg), {
      waitUntil: "load",
      timeout: config.renderTimeoutMs,
    });
    return;
  }
  if (type === "d2") {
    const svg = await d2ToSvg(content);
    await page.setContent(d2PreviewHtml(svg), {
      waitUntil: "load",
      timeout: config.renderTimeoutMs,
    });
    return;
  }
  throw new Error(`renderer for type "${type}" not yet implemented`);
}

// v0.9.2 Phase F · Decision iii — kill animation / transition in render
// shells so the screenshot is deterministic across re-renders. Owner
// picked B (animation:none for mermaid + vega-lite + defensive d2/dot).
// Live preview path is unaffected — different code path that hits the
// shell HTML via /api/visuals/<id>/preview, not setContent.
export const ANIMATION_KILL_CSS =
  `* { animation: none !important; -webkit-animation: none !important; transition: none !important; -webkit-transition: none !important; }`;

function mermaidShell(source: string): string {
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  ${ANIMATION_KILL_CSS}
  html,body{margin:0;background:#0b1220;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{padding:32px}
  pre.mermaid{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:24px;margin:0}
  pre.mermaid svg{max-width:100%;height:auto;display:block;margin:0 auto}
</style>
</head>
<body>
<div class="wrap"><pre class="mermaid">${escaped}</pre></div>
<script type="module">
  import mermaid from "${getBaseUrl()}/assets/mermaid/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: "dark" });
  try {
    await mermaid.run({ querySelector: "pre.mermaid" });
    document.body.dataset.mermaidReady = "true";
  } catch (e) {
    document.body.dataset.mermaidReady = "error";
  }
</script>
</body></html>`;
}

