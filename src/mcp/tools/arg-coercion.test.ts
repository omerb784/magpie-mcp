import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../render/index.js", () => ({
  enqueueRender: vi.fn(),
  shutdownRender: vi.fn(async () => {}),
  thumbPath: (id: string, n: number) => `/tmp/${id}/v${n}.png`,
}));
vi.mock("../../http/ws.js", () => ({ broadcast: vi.fn(), setupWs: vi.fn() }));

import { closeDb } from "../../store/db.js";
import { dispatchCallTool } from "../server.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function body(r: { content: Array<{ type: string; text?: string }>; isError?: boolean }) {
  const part = r.content[0];
  return part && "text" in part ? (part.text ?? "") : "";
}

describe("arg coercion edge sweep · v0.9.2 Phase C / T3 (per-tool message quality)", () => {
  it("find_visuals · tags as string instead of array → clear rejection", async () => {
    const r = await dispatchCallTool("find_visuals", { tags: "wip" });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
    expect(body(r).toLowerCase()).toMatch(/array|tags/);
  });

  it("find_visuals · starred as number instead of boolean → clear rejection", async () => {
    const r = await dispatchCallTool("find_visuals", { starred: 1 });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
    expect(body(r).toLowerCase()).toMatch(/bool|starred/);
  });

  it("create_project · type as wrong enum value → clear rejection naming the enum", async () => {
    const r = await dispatchCallTool("create_project", { name: "p", type: "garbage" });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
    expect(body(r).toLowerCase()).toMatch(/mockup|diagram|mixed|enum/);
  });

  it("add_visual · oversized description (>2000 chars) → clear rejection", async () => {
    const big = "x".repeat(2001);
    const r = await dispatchCallTool("add_visual", {
      project: "p",
      type: "html",
      content: "<html></html>",
      description: big,
    });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
  });

  it("add_visual · unknown extra arg → strict() rejection (decision ii)", async () => {
    const r = await dispatchCallTool("add_visual", {
      project: "p",
      type: "html",
      content: "<html></html>",
      surprise_field: true,
    });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
    expect(body(r).toLowerCase()).toMatch(/unrecognized|unknown|additional|surprise_field/);
  });

  it("iterate · missing visual_id → clear rejection naming the required field", async () => {
    const r = await dispatchCallTool("iterate", { content: "<html></html>" });
    expect(r.isError).toBe(true);
    expect(body(r)).toContain("Invalid arguments");
    expect(body(r).toLowerCase()).toContain("visual_id");
  });
});
