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
import { createProject } from "../../store/projects.js";
import { appendVersion } from "../../store/versions.js";
import { createVisual } from "../../store/visuals.js";
import { LIST_PROJECTS_CAP, listProjectsTool } from "./list_projects.js";
import { LIST_VERSIONS_CAP, listVersionsTool } from "./list_versions.js";

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

describe("list-shaped tool caps · v0.9.2 Phase C / M9", () => {
  it("LIST_VERSIONS_CAP + LIST_PROJECTS_CAP constants = 200", () => {
    expect(LIST_VERSIONS_CAP).toBe(200);
    expect(LIST_PROJECTS_CAP).toBe(200);
  });

  it("list_projects · 199 entries · no overflow tail", async () => {
    for (let i = 0; i < 199; i++) {
      createProject(`p${String(i).padStart(3, "0")}`, "mockup");
    }
    const r = await listProjectsTool.handler({});
    const t = text(r);
    expect(t).not.toContain("more project(s)");
  });

  it("list_projects · 201 entries · '+1 more' tail line + body capped", async () => {
    for (let i = 0; i < 201; i++) {
      createProject(`p${String(i).padStart(3, "0")}`, "mockup");
    }
    const r = await listProjectsTool.handler({});
    const t = text(r);
    expect(t).toContain("+1 more project(s)");
    const bodyRows = t.split("\n").filter((l) => /^p\d+/.test(l));
    expect(bodyRows.length).toBe(LIST_PROJECTS_CAP);
  });

  it("list_versions · 199 entries · no overflow tail", async () => {
    const proj = createProject("p", "mockup");
    const visual = createVisual({ project_id: proj.id, title: "v", type: "html", source: null });
    // visual v1 already implicit via createVisual; seed versions 1..199
    for (let i = 0; i < 199; i++) {
      appendVersion({
        visual_id: visual.id,
        version_num: i + 1,
        content_path: `/tmp/${visual.id}/v${i + 1}.html`,
        message: null,
        description: null,
      });
    }
    const r = await listVersionsTool.handler({ visual_id: visual.id });
    const t = text(r);
    expect(t).not.toContain("more version(s)");
  });

  it("list_versions · 201 entries · '+1 more' tail", async () => {
    const proj = createProject("p", "mockup");
    const visual = createVisual({ project_id: proj.id, title: "v", type: "html", source: null });
    for (let i = 0; i < 201; i++) {
      appendVersion({
        visual_id: visual.id,
        version_num: i + 1,
        content_path: `/tmp/${visual.id}/v${i + 1}.html`,
        message: null,
        description: null,
      });
    }
    const r = await listVersionsTool.handler({ visual_id: visual.id });
    const t = text(r);
    expect(t).toContain("+1 more version(s)");
  });
});
