import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "../store/db.js";
import { createProject } from "../store/projects.js";
import { appendVersion, listForVisual } from "../store/versions.js";
import { createVisual } from "../store/visuals.js";

const broadcasts: unknown[] = [];
const pageCalls: { type: string; content: string }[] = [];
let nextPageBehavior: "ok" | "throw" = "ok";

vi.mock("./browser.js", () => ({
  getBrowser: async () => ({
    newPage: async () => ({
      setViewport: async () => {},
      setContent: async (content: string) => {
        pageCalls.push({ type: "setContent", content });
        if (nextPageBehavior === "throw") throw new Error("boom");
      },
      waitForFunction: async () => {},
      evaluate: async () => "true",
      screenshot: async ({ path }: { path: string }) => {
        writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      },
      close: async () => {},
    }),
  }),
  closeBrowser: async () => {},
}));

vi.mock("../http/ws.js", () => ({
  broadcast: (event: unknown) => {
    broadcasts.push(event);
  },
}));

vi.mock("../runtime.js", () => ({
  setBaseUrl: () => {},
  getBaseUrl: () => "http://localhost:0",
}));

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  broadcasts.length = 0;
  pageCalls.length = 0;
  nextPageBehavior = "ok";
});

afterEach(() => {
  closeDb();
});

async function flushQueue(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

function setupVisual(): { visualId: string; versionId: string; contentPath: string } {
  const project = createProject("render-test", "mockup");
  const visual = createVisual({
    project_id: project.id,
    title: "t",
    type: "html",
    source: null,
  });
  const home = process.env.MAGPIE_HOME!;
  const contentPath = join(home, `${visual.id}-v1.html`);
  writeFileSync(contentPath, "<html><body>hi</body></html>");
  const v = appendVersion({
    visual_id: visual.id,
    version_num: 1,
    content_path: contentPath,
    message: null,
  });
  return { visualId: visual.id, versionId: v.id, contentPath };
}

describe("render queue", () => {
  it("enqueueRender drains job and marks version ok", async () => {
    const { enqueueRender } = await import("./index.js");
    const { visualId, versionId, contentPath } = setupVisual();
    enqueueRender({
      visual_id: visualId,
      version_id: versionId,
      version_num: 1,
      type: "html",
      content_path: contentPath,
    });
    await flushQueue();
    const versions = listForVisual(visualId);
    expect(versions[0]?.render_status).toBe("ok");
    expect(versions[0]?.thumb_path).toMatch(/v1\.png$/);
    expect(broadcasts.some((b: any) => b.kind === "version.rendered" && b.status === "ok")).toBe(true);
  });

  it("processes multiple enqueues in FIFO order", async () => {
    const { enqueueRender } = await import("./index.js");
    const project = createProject("render-fifo", "mockup");
    const order: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const v = createVisual({ project_id: project.id, title: `v${i}`, type: "html", source: null });
      const home = process.env.MAGPIE_HOME!;
      const cp = join(home, `${v.id}-v1.html`);
      writeFileSync(cp, `<html>${i}</html>`);
      const ver = appendVersion({
        visual_id: v.id,
        version_num: 1,
        content_path: cp,
        message: null,
      });
      enqueueRender({
        visual_id: v.id,
        version_id: ver.id,
        version_num: 1,
        type: "html",
        content_path: cp,
      });
      order.push(i);
    }
    await flushQueue();
    const okBroadcasts = broadcasts.filter((b: any) => b.kind === "version.rendered" && b.status === "ok");
    expect(okBroadcasts.length).toBe(3);
  });

  it("captures puppeteer error as failed status", async () => {
    nextPageBehavior = "throw";
    const { enqueueRender } = await import("./index.js");
    const { visualId, versionId, contentPath } = setupVisual();
    enqueueRender({
      visual_id: visualId,
      version_id: versionId,
      version_num: 1,
      type: "html",
      content_path: contentPath,
    });
    await flushQueue();
    const versions = listForVisual(visualId);
    expect(versions[0]?.render_status).toBe("failed");
    expect(versions[0]?.render_error).toContain("boom");
    expect(broadcasts.some((b: any) => b.kind === "version.rendered" && b.status === "failed")).toBe(true);
  });

  it("shutdownRender clears queued jobs", async () => {
    const { enqueueRender, shutdownRender } = await import("./index.js");
    const { visualId, versionId, contentPath } = setupVisual();
    enqueueRender({
      visual_id: visualId,
      version_id: versionId,
      version_num: 1,
      type: "html",
      content_path: contentPath,
    });
    await flushQueue();
    await shutdownRender();
    expect(broadcasts.length).toBeGreaterThan(0);
  });
});
