import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { TOOLS } from "../mcp/tools/index.js";
import type { Tool } from "../mcp/types.js";

interface SchemaCase {
  tool: Tool;
  good: Record<string, unknown>;
}

const CASES: SchemaCase[] = [
  { tool: get("create_project"), good: { name: "p", type: "mockup" } },
  { tool: get("add_visual"), good: { project: "p", type: "html", content: "<p>x</p>" } },
  { tool: get("iterate"), good: { visual_id: "v1", content: "<p>y</p>" } },
  { tool: get("find_visuals"), good: {} },
  { tool: get("compare"), good: { visual_id: "v1" } },
  { tool: get("open_preview"), good: { visual_id: "v1" } },
  { tool: get("update_visual"), good: { visual_id: "v1", title: "t" } },
  { tool: get("archive_visual"), good: { visual_id: "v1" } },
  { tool: get("archive_project"), good: { name: "p" } },
  { tool: get("update_project"), good: { old_name: "p", new_name: "q" } },
  { tool: get("merge_projects"), good: { src_name: "a", dst_name: "b" } },
  { tool: get("list_projects"), good: {} },
  { tool: get("list_versions"), good: { visual_id: "v1" } },
  { tool: get("read_inbox"), good: {} },
];

function get(name: string): Tool {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t;
}

describe("M2 · strict tool schemas (additionalProperties:false × 14)", () => {
  it("registers exactly 14 tools (R6 + R11 + R12 lock)", () => {
    expect(TOOLS.length).toBe(14);
    expect(CASES.length).toBe(14);
  });

  it("every tool inputSchema declares additionalProperties:false", () => {
    for (const t of TOOLS) {
      const schema = t.inputSchema as { additionalProperties?: unknown };
      expect(schema.additionalProperties, `${t.name} missing additionalProperties:false`).toBe(false);
    }
  });

  for (const { tool, good } of CASES) {
    describe(tool.name, () => {
      it("accepts known-arg shape", () => {
        const r = (tool.argsSchema as z.ZodTypeAny).safeParse(good);
        expect(r.success, errMsg(r)).toBe(true);
      });

      it("rejects unknown extra arg", () => {
        const r = (tool.argsSchema as z.ZodTypeAny).safeParse({
          ...good,
          unknown_extra_arg: "x",
        });
        expect(r.success).toBe(false);
        if (!r.success) {
          const msg = JSON.stringify(r.error.issues);
          expect(msg).toMatch(/unrecognized|unknown_extra_arg/i);
        }
      });
    });
  }
});

function errMsg(r: { success: boolean; error?: { message: string } }): string {
  return r.success ? "" : r.error?.message ?? "parse failed";
}
