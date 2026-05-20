import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "./instructions.js";
import { INSTRUCTIONS_VERSION } from "../config.js";

describe("MCP instructions string (v0.9.2 Phase C / M7 — aggressive trim, decision iii)", () => {
  it("first line is the skill-defer line", () => {
    const firstLine = INSTRUCTIONS.split("\n")[0];
    expect(firstLine).toBe(
      "If the magpie-master skill is loaded, defer to it for all decisions below. Otherwise apply the rules here."
    );
  });

  it("INSTRUCTIONS_VERSION bumped to '11' for the aggressive trim", () => {
    expect(INSTRUCTIONS_VERSION).toBe("11");
  });

  it("minimal fallback substrate covers the 6 load-bearing topics", () => {
    expect(INSTRUCTIONS).toContain("Magpie lands");
    expect(INSTRUCTIONS).toContain("Tools:");
    expect(INSTRUCTIONS).toContain("Resources:");
    expect(INSTRUCTIONS).toContain("Prompts");
    expect(INSTRUCTIONS).toContain("Types:");
    expect(INSTRUCTIONS).toContain("Rules:");
  });

  it("fallback names all 14 MCP tools", () => {
    for (const tool of [
      "add_visual",
      "iterate",
      "list_projects",
      "find_visuals",
      "list_versions",
      "open_preview",
      "compare",
      "update_visual",
      "update_project",
      "archive_visual",
      "archive_project",
      "merge_projects",
      "read_inbox",
    ]) {
      expect(INSTRUCTIONS).toContain(tool);
    }
    // create_project isn't in the fallback (add_visual auto-creates); kept for
    // M7 trim — `magpie-master` skill carries the long-form decision flow.
  });

  it("fallback names all 7 supported formats", () => {
    for (const t of ["html", "mermaid", "svg", "markdown", "dot", "vega-lite", "d2"]) {
      expect(INSTRUCTIONS).toContain(t);
    }
  });

  it("fallback names all 8 prompts", () => {
    for (const p of [
      "iterate",
      "variants",
      "explain",
      "a11y_audit",
      "responsive_check",
      "dark_mode_port",
      "simplify",
      "add_data",
    ]) {
      expect(INSTRUCTIONS).toContain(p);
    }
  });

  it("fallback fits under 2 KB (aggressive-trim target: ~1-1.5 KB)", () => {
    const bytes = Buffer.byteLength(INSTRUCTIONS, "utf8");
    expect(bytes).toBeLessThan(2048);
  });

  it("retired sections from v10 narrative are gone", () => {
    expect(INSTRUCTIONS).not.toContain("Decision flow:");
    expect(INSTRUCTIONS).not.toContain("Hard rules:");
    expect(INSTRUCTIONS).not.toContain("Type heuristic:");
    // Long marketing tagline retired — the skill carries it.
    expect(INSTRUCTIONS).not.toContain("the nest for mockups");
  });
});
