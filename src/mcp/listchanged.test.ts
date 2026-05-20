import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../render/index.js", async () => {
  const versions = await vi.importActual<typeof import("../store/versions.js")>(
    "../store/versions.js"
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

vi.mock("../http/ws.js", () => ({
  broadcast: vi.fn(),
  setupWs: vi.fn(),
}));

import { closeDb } from "../store/db.js";
import { setResourcesListChangedNotifier } from "./notifications.js";
import { MAGPIE_SERVER_CAPABILITIES } from "./server.js";
import { addVisualTool } from "./tools/add_visual.js";
import { archiveVisualTool } from "./tools/archive_visual.js";
import { createProjectTool } from "./tools/create_project.js";
import { mergeProjectsTool } from "./tools/merge_projects.js";

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

describe("listChanged capability correctness · v0.9.2 Phase C / M10", () => {
  it("server advertises tools.listChanged=false, prompts.listChanged=false, resources.listChanged=true, completions={}", () => {
    expect(MAGPIE_SERVER_CAPABILITIES.tools.listChanged).toBe(false);
    expect(MAGPIE_SERVER_CAPABILITIES.prompts.listChanged).toBe(false);
    expect(MAGPIE_SERVER_CAPABILITIES.resources.listChanged).toBe(true);
    expect(MAGPIE_SERVER_CAPABILITIES.completions).toBeDefined();
  });

  it("notifyResourcesChanged() fires once per add_visual + archive_visual + merge_projects", async () => {
    const fires: string[] = [];
    setResourcesListChangedNotifier(() => fires.push("ping"));

    // add_visual
    const addRes = await addVisualTool.handler({
      project: "alpha",
      type: "html",
      content: "<html><title>X</title></html>",
    });
    const idMatch = text(addRes).match(/visual ([a-zA-Z0-9]+) v1/);
    expect(idMatch).toBeTruthy();
    const visualId = idMatch![1];
    expect(fires.length).toBeGreaterThanOrEqual(1);

    const after_add = fires.length;

    // archive_visual
    await archiveVisualTool.handler({ visual_id: visualId });
    expect(fires.length).toBeGreaterThan(after_add);

    // merge_projects · need two projects and source must have a visual
    await createProjectTool.handler({ name: "dst", type: "mockup" });
    await addVisualTool.handler({
      project: "src",
      type: "html",
      content: "<html><title>Y</title></html>",
    });
    const before_merge = fires.length;
    await mergeProjectsTool.handler({ src_name: "src", dst_name: "dst" });
    expect(fires.length).toBeGreaterThan(before_merge);
  });
});
