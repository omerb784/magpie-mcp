import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { startHttpServer, type HttpHandle } from "../http/server.js";
import { createProject } from "../store/projects.js";
import { createVisual } from "../store/visuals.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { clearStaleSingletons, closeBrowser, getBrowser } from "./browser.js";
import { enqueueRender, isBrowserDisconnectError, shutdownRender } from "./index.js";

const GOOD_HTML = `<!doctype html><html><body><p>restart probe</p></body></html>`;

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

function setupGoodHtmlJob(label: string): { visualId: string } {
  const project = createProject(`f-restart-${label}-${Date.now()}`, "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: `restart ${label}`,
    type: "html",
    source: null,
  });
  const home = process.env.MAGPIE_HOME!;
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
  enqueueRender({
    visual_id: visual.id,
    version_id: version.id,
    version_num: 1,
    type: "html",
    content_path: blobPath,
  });
  return { visualId: visual.id };
}

describe("Decision ii · auto-restart browser on dead handle", () => {
  describe("isBrowserDisconnectError helper", () => {
    it.each([
      "Target closed",
      "Protocol error (Target.createTarget): Target closed.",
      "Connection closed",
      "Browser closed during page navigation",
      "Session closed. Most likely the page has been closed.",
      "The browser has disconnected.",
      // v0.9.3 Phase A — spawn-fail patterns promoted to the disconnect
      // bucket so a SingletonLock collision (or any other launch error)
      // triggers the existing one-retry budget. clearStaleSingletons()
      // on the retry path removes the lock, so retry usually succeeds.
      "Failed to launch the browser process! undefined",
      "Failed to launch the browser process! [3992:14172:...] ProcessSingleton",
      "ProcessSingleton failed to acquire lock",
      "SingletonLock present",
    ])("matches: %s", (msg) => {
      expect(isBrowserDisconnectError(new Error(msg))).toBe(true);
    });

    it.each([
      "mermaid render failed",
      "vega-lite spec is not valid JSON: ...",
      "render did not complete",
      "ENOENT: no such file",
      "Permission denied",
    ])("does NOT match unrelated error: %s", (msg) => {
      expect(isBrowserDisconnectError(new Error(msg))).toBe(false);
    });

    it("matches when given a plain string instead of Error", () => {
      expect(isBrowserDisconnectError("Target closed")).toBe(true);
      expect(isBrowserDisconnectError("normal failure")).toBe(false);
    });
  });

  describe("clearStaleSingletons · v0.9.3 Phase A", () => {
    let scratch: string;

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), "magpie-stale-singleton-"));
    });

    afterEach(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it("removes SingletonLock + SingletonCookie + SingletonSocket when present", () => {
      writeFileSync(join(scratch, "SingletonLock"), "stale-pid");
      writeFileSync(join(scratch, "SingletonCookie"), "stale-cookie");
      writeFileSync(join(scratch, "SingletonSocket"), "stale-socket");
      writeFileSync(join(scratch, "Default.json"), "{}"); // unrelated — must survive

      clearStaleSingletons(scratch);

      expect(existsSync(join(scratch, "SingletonLock"))).toBe(false);
      expect(existsSync(join(scratch, "SingletonCookie"))).toBe(false);
      expect(existsSync(join(scratch, "SingletonSocket"))).toBe(false);
      // Unrelated profile files must NOT be touched.
      expect(existsSync(join(scratch, "Default.json"))).toBe(true);
    });

    it("is idempotent when no singleton files exist", () => {
      // Empty profile dir — should not throw, should not create files.
      expect(() => clearStaleSingletons(scratch)).not.toThrow();
    });

    it("does not throw when userDataDir itself does not exist", () => {
      const missing = join(scratch, "does-not-exist");
      expect(() => clearStaleSingletons(missing)).not.toThrow();
    });
  });

  describe("getBrowser lazy-relaunch end-to-end", () => {
    it("a job enqueued after closeBrowser() succeeds via fresh launch", async () => {
      if (!chromeAvailable) return;

      // Render once to confirm baseline ok.
      const first = setupGoodHtmlJob("first");
      await waitForRender(first.visualId);
      expect(listForVisual(first.visualId)[0]!.render_status).toBe("ok");

      // Simulate Chrome crash by closing the cached browser. This clears
      // the in-memory singleton; getBrowser() on the next render must
      // re-launch — the "auto-restart" promise of decision ii.
      const before = await getBrowser();
      await closeBrowser();

      // Next render must succeed cleanly via the relaunch path.
      const second = setupGoodHtmlJob("second");
      await waitForRender(second.visualId);
      const v = listForVisual(second.visualId)[0]!;
      expect(v.render_status, `relaunch render failed: ${v.render_error}`).toBe("ok");

      // Sanity: the new browser is a different instance (process pid differs).
      const after = await getBrowser();
      expect(after).not.toBe(before);
    }, 90_000);
  });
});
