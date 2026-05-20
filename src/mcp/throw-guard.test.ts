import { existsSync, mkdirSync, rmSync } from "node:fs";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { dispatchCallTool } from "./server.js";
import { TOOLS } from "./tools/index.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uncaught tool-handler throw guard · v0.9.2 Phase C / T1", () => {
  it("unknown tool → semantic error (not throw)", async () => {
    const r = await dispatchCallTool("not_a_tool", {});
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Unknown tool");
  });

  it("invalid args → semantic error (not throw)", async () => {
    const r = await dispatchCallTool("create_project", { name: "" });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("Invalid arguments");
  });

  for (const tool of TOOLS) {
    it(`${tool.name} · handler throw → McpError InternalError, single-line, no raw stack`, async () => {
      const original = tool.handler;
      (tool as { handler: unknown }).handler = () => {
        throw new Error("boom\nfake stack line 1\nfake stack line 2");
      };

      try {
        const validArgs = pickValidArgsFor(tool.name);
        let caught: unknown = null;
        try {
          await dispatchCallTool(tool.name, validArgs);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(McpError);
        const err = caught as McpError;
        expect(err.code).toBe(ErrorCode.InternalError);
        expect(err.message).toContain(`Tool ${tool.name} failed:`);
        expect(err.message).not.toMatch(/\n/);
        expect(err.message).not.toContain("fake stack line 1");
        expect(err.message).toContain("boom");
      } finally {
        (tool as { handler: unknown }).handler = original;
      }
    });
  }
});

function pickValidArgsFor(name: string): Record<string, unknown> {
  switch (name) {
    case "create_project":
      return { name: "p", type: "mockup" };
    case "add_visual":
      return { project: "p", type: "html", content: "<html></html>" };
    case "iterate":
      return { visual_id: "id_anything", content: "<html></html>" };
    case "find_visuals":
      return {};
    case "compare":
      return { visual_id: "id_anything" };
    case "open_preview":
      return { visual_id: "id_anything" };
    case "update_visual":
      return { visual_id: "id_anything", title: "x" };
    case "archive_visual":
      return { visual_id: "id_anything" };
    case "archive_project":
      return { name: "p" };
    case "update_project":
      return { old_name: "p", description: "x" };
    case "merge_projects":
      return { src_name: "a", dst_name: "b" };
    case "list_projects":
      return {};
    case "list_versions":
      return { visual_id: "id_anything" };
    case "read_inbox":
      return {};
    default:
      return {};
  }
}
