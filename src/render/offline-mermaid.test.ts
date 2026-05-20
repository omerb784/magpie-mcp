import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { config } from "../config.js";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { closeBrowser, getBrowser } from "./browser.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const LOCAL_SCHEMES = new Set(["data:", "about:", "blob:", "chrome-error:", "chrome:"]);

function isLocalRequest(url: string): boolean {
  for (const scheme of LOCAL_SCHEMES) {
    if (url.startsWith(scheme)) return true;
  }
  try {
    const u = new URL(url);
    return LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const MERMAID_SOURCE = `flowchart TD
  A[Magpie] --> B[Nest]
  B --> C[Owner]`;

function mermaidPageHtml(baseUrl: string, source: string): string {
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;background:#0b1220;color:#e2e8f0;font-family:sans-serif}
  pre.mermaid{margin:0;padding:24px}
</style>
</head>
<body>
<pre class="mermaid">${escaped}</pre>
<script type="module">
  import mermaid from "${baseUrl}/assets/mermaid/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: "dark" });
  try {
    await mermaid.run({ querySelector: "pre.mermaid" });
    document.body.dataset.mermaidReady = "true";
  } catch (e) {
    document.body.dataset.mermaidReady = "error";
    document.body.dataset.mermaidErrorMessage = String(e && e.message || e);
  }
</script>
</body></html>`;
}

let httpHandle: HttpHandle | null = null;
let browser: Browser | null = null;
let chromeAvailable = false;

beforeAll(async () => {
  try {
    browser = await getBrowser();
    chromeAvailable = true;
  } catch {
    chromeAvailable = false;
    return;
  }
  httpHandle = await startHttpServer();
}, 30_000);

afterAll(async () => {
  if (httpHandle) {
    await httpHandle.close();
    httpHandle = null;
  }
  if (browser) {
    await closeBrowser();
    browser = null;
  }
}, 30_000);

describe("F5b · mermaid render must not touch non-local hosts (R7 compliance)", () => {
  it.runIf(true)("interceptor records zero non-local requests during mermaid render", async () => {
    if (!chromeAvailable || !browser || !httpHandle) {
      // Chrome not installed in this environment — skip cleanly.
      return;
    }

    const baseUrl = `http://${config.bind}:${httpHandle.port}`;
    const page: Page = await browser.newPage();
    const requested: string[] = [];
    const nonLocal: string[] = [];

    let state: string | undefined;
    let errorMsg: string | null = null;

    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        requested.push(url);
        if (!isLocalRequest(url)) {
          nonLocal.push(url);
          void req.abort();
          return;
        }
        void req.continue();
      });

      await page.setContent(mermaidPageHtml(baseUrl, MERMAID_SOURCE), {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      await page.waitForFunction(
        'document.body.dataset.mermaidReady === "true" || document.body.dataset.mermaidReady === "error"',
        { timeout: 15_000 },
      );

      state = await page.evaluate(() => document.body.dataset["mermaidReady"]);
      errorMsg = (await page.evaluate(
        () => document.body.dataset["mermaidErrorMessage"] ?? null,
      )) as string | null;
    } finally {
      await page.close().catch(() => {});
    }

    expect(state).toBe("true");
    expect(errorMsg).toBeNull();
    expect(nonLocal).toEqual([]);
    // Sanity: at least one local request was made (the mermaid module fetch).
    expect(requested.some((u) => u.includes("/assets/mermaid/"))).toBe(true);
  }, 30_000);

  it("isLocalRequest classifier accepts loopback hosts + browser schemes", () => {
    expect(isLocalRequest("http://127.0.0.1:1234/x")).toBe(true);
    expect(isLocalRequest("http://localhost:8080/y")).toBe(true);
    expect(isLocalRequest("data:text/plain;base64,Zm9v")).toBe(true);
    expect(isLocalRequest("about:blank")).toBe(true);
    expect(isLocalRequest("blob:http://localhost/abc")).toBe(true);
  });

  it("isLocalRequest classifier rejects every CDN mermaid commonly ships from", () => {
    expect(isLocalRequest("https://cdn.jsdelivr.net/npm/mermaid")).toBe(false);
    expect(isLocalRequest("https://unpkg.com/mermaid")).toBe(false);
    expect(isLocalRequest("https://esm.sh/mermaid")).toBe(false);
    expect(isLocalRequest("https://cdnjs.cloudflare.com/ajax/libs/mermaid")).toBe(false);
    expect(isLocalRequest("https://example.com/x")).toBe(false);
  });
});
