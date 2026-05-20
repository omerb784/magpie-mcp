import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../render/index.js", async () => {
  const versions = await vi.importActual<typeof import("../../store/versions.js")>(
    "../../store/versions.js"
  );
  return {
    enqueueRender: vi.fn((job: { version_id: string }) => {
      versions.setRenderStatus({
        version_id: job.version_id,
        status: "ok",
        thumb_path: null,
        error: null,
      });
    }),
    shutdownRender: vi.fn(async () => {}),
    thumbPath: (id: string, n: number) => `/tmp/${id}/v${n}.png`,
  };
});

vi.mock("../../http/ws.js", () => ({
  broadcast: vi.fn(),
  setupWs: vi.fn(),
}));

import { closeDb } from "../../store/db.js";
import { addVisualTool } from "./add_visual.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function text(r: { content: Array<{ type: string; text?: string }> }) {
  const part = r.content[0];
  return part && "text" in part ? (part.text ?? "") : "";
}

describe("add_visual idempotency contract · v0.9.2 Phase C / T2 (always-insert)", () => {
  it("two identical add_visual calls produce DISTINCT visual ids", async () => {
    const args = {
      project: "alpha",
      type: "html" as const,
      content: "<html><title>X</title></html>",
      title: "X",
    };
    const r1 = await addVisualTool.handler(args);
    const r2 = await addVisualTool.handler(args);
    const id1 = text(r1).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    const id2 = text(r2).match(/visual ([a-zA-Z0-9]+) v1/)?.[1];
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});
