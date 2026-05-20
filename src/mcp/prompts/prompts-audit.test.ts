import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PROMPTS } from "./index.js";

// v0.9.2 / Phase C / M6 — pin the prompt-surface invariants we audited.
// These tests guard the contract the MCP server layer (src/mcp/server.ts
// `GetPromptRequestSchema` handler) depends on: every prompt has a Zod
// `argsSchema` that safeParse runs cleanly through, and every `render` is
// a deterministic pure function of its parsed args (so the LLM-facing
// body is reproducible from logged arg JSON).

describe("M6 · prompt surface audit pins", () => {
  it("every prompt's argsSchema is a Zod schema with safeParse", () => {
    for (const p of PROMPTS) {
      expect(p.argsSchema).toBeInstanceOf(z.ZodType);
      expect(typeof p.argsSchema.safeParse).toBe("function");
    }
  });

  it("every prompt's render produces a non-empty string for valid args", () => {
    // Provide visual_id-only baseline; optional args fall through to defaults.
    // Use prompt-specific required fields where applicable.
    const seed = (name: string): Record<string, unknown> => {
      switch (name) {
        case "iterate":
          return { visual_id: "v1", direction: "audit pin" };
        case "add_data":
          return { visual_id: "v1", data_description: "audit pin" };
        default:
          return { visual_id: "v1" };
      }
    };
    for (const p of PROMPTS) {
      const parsed = p.argsSchema.safeParse(seed(p.name));
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      const body = p.render(parsed.data);
      expect(typeof body).toBe("string");
      expect(body.length).toBeGreaterThan(50);
    }
  });

  it("every prompt's render is deterministic for the same parsed args", () => {
    for (const p of PROMPTS) {
      const args =
        p.name === "iterate"
          ? { visual_id: "vis_xyz", direction: "swap colors" }
          : p.name === "add_data"
            ? { visual_id: "vis_xyz", data_description: "test" }
            : { visual_id: "vis_xyz" };
      const parsed = p.argsSchema.safeParse(args);
      if (!parsed.success) throw new Error(`seed failed for ${p.name}`);
      const a = p.render(parsed.data);
      const b = p.render(parsed.data);
      expect(a).toBe(b);
    }
  });

  it("every prompt's render embeds the visual_id (so the model loads the right resource)", () => {
    for (const p of PROMPTS) {
      const args =
        p.name === "iterate"
          ? { visual_id: "vis_xyz", direction: "x" }
          : p.name === "add_data"
            ? { visual_id: "vis_xyz", data_description: "x" }
            : { visual_id: "vis_xyz" };
      const parsed = p.argsSchema.safeParse(args);
      if (!parsed.success) throw new Error(`seed failed for ${p.name}`);
      const body = p.render(parsed.data);
      expect(body).toContain("magpie://visual/vis_xyz");
    }
  });

  it("server layer strips unknown args before render (Zod object default 'strip')", () => {
    // Pin the pass-through-cleanness contract: an extra unknown arg from the
    // host should NOT reach the render fn. This matches default Zod object
    // behavior (strip), and we keep prompts non-strict so future hosts can
    // pass forward-compat hints without erroring the slash menu. Decision ii
    // only locked tools strict — prompts stay strip-lenient by design.
    const args = { visual_id: "vis_xyz", direction: "x", bogus_extra: "should be dropped" };
    const parsed = PROMPTS.find((p) => p.name === "iterate")!.argsSchema.safeParse(args);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("bogus_extra");
  });
});
