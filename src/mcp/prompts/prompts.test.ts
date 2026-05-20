import { describe, expect, it } from "vitest";
import { a11yAuditPrompt } from "./a11y_audit.js";
import { addDataPrompt } from "./add_data.js";
import { darkModePortPrompt } from "./dark_mode_port.js";
import { explainPrompt } from "./explain.js";
import { PROMPTS, PROMPTS_BY_NAME } from "./index.js";
import { iteratePrompt } from "./iterate.js";
import { responsiveCheckPrompt } from "./responsive_check.js";
import { simplifyPrompt } from "./simplify.js";
import { variantsPrompt } from "./variants.js";

describe("prompts registry (P2.B + S5 P4.A)", () => {
  it("PROMPTS array surfaces 3 S4 builtins + 5 S5 Magpie verbs (8 total)", () => {
    expect(PROMPTS).toHaveLength(8);
    const names = PROMPTS.map((p) => p.name).sort();
    expect(names).toEqual([
      "a11y_audit",
      "add_data",
      "dark_mode_port",
      "explain",
      "iterate",
      "responsive_check",
      "simplify",
      "variants",
    ]);
  });

  it("PROMPTS_BY_NAME maps each prompt by name", () => {
    expect(PROMPTS_BY_NAME.iterate).toBe(iteratePrompt);
    expect(PROMPTS_BY_NAME.variants).toBe(variantsPrompt);
    expect(PROMPTS_BY_NAME.explain).toBe(explainPrompt);
  });

  it("every prompt carries name + description + arguments + render", () => {
    for (const p of PROMPTS) {
      expect(p.name).toBeTruthy();
      expect(p.description.length).toBeGreaterThan(20);
      expect(Array.isArray(p.arguments)).toBe(true);
      expect(typeof p.render).toBe("function");
      const required = p.arguments.filter((a) => a.required);
      expect(required.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("iterate prompt", () => {
  it("rejects missing required args", () => {
    const r1 = iteratePrompt.argsSchema.safeParse({});
    expect(r1.success).toBe(false);
    const r2 = iteratePrompt.argsSchema.safeParse({ visual_id: "v1" });
    expect(r2.success).toBe(false);
  });

  it("renders XML-wrapped body with visual_context + task interpolation", () => {
    const body = iteratePrompt.render({ visual_id: "vis_abc", direction: "make it dark mode" });
    expect(body).toContain("<instructions>");
    expect(body).toContain("<visual_context>\nmagpie://visual/vis_abc\n</visual_context>");
    expect(body).toContain("<task>");
    expect(body).toContain("make it dark mode");
    expect(body).toContain("iterate(visual_id=\"vis_abc\"");
  });
});

describe("variants prompt", () => {
  it("defaults count to 3 and dimension to 'overall style'", () => {
    const body = variantsPrompt.render({ visual_id: "v1" });
    expect(body).toContain("3 distinct variants");
    expect(body).toContain("overall style");
  });

  it("coerces string count from MCP arg layer and respects custom dimension", () => {
    const parsed = variantsPrompt.argsSchema.safeParse({
      visual_id: "v1",
      count: "4",
      dimension: "color palette",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = variantsPrompt.render(parsed.data);
    expect(body).toContain("4 distinct variants");
    expect(body).toContain("color palette");
  });

  it("rejects count outside 2-6 range", () => {
    const tooFew = variantsPrompt.argsSchema.safeParse({ visual_id: "v1", count: 1 });
    const tooMany = variantsPrompt.argsSchema.safeParse({ visual_id: "v1", count: 7 });
    expect(tooFew.success).toBe(false);
    expect(tooMany.success).toBe(false);
  });
});

describe("explain prompt", () => {
  it("defaults audience to 'developer' and forbids iterate/add_visual", () => {
    const body = explainPrompt.render({ visual_id: "v1" });
    expect(body).toContain("Explain the visual above to a developer.");
    expect(body).toContain("Do NOT call `iterate` or `add_visual`");
  });

  it("respects custom audience and references the magpie:// resource", () => {
    const body = explainPrompt.render({ visual_id: "vis_xyz", audience: "PM" });
    expect(body).toContain("Explain the visual above to a PM.");
    expect(body).toContain("magpie://visual/vis_xyz");
  });

  it("rejects missing visual_id", () => {
    const result = explainPrompt.argsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("prompt lookup error paths", () => {
  it("PROMPTS_BY_NAME returns undefined for unknown prompt — handler throws McpError on this", () => {
    expect(PROMPTS_BY_NAME["bogus"]).toBeUndefined();
    expect(PROMPTS_BY_NAME["Iterate"]).toBeUndefined();
  });

  it("rejects empty-string required args across all prompts", () => {
    expect(iteratePrompt.argsSchema.safeParse({ visual_id: "", direction: "x" }).success).toBe(false);
    expect(iteratePrompt.argsSchema.safeParse({ visual_id: "v1", direction: "" }).success).toBe(false);
    expect(variantsPrompt.argsSchema.safeParse({ visual_id: "" }).success).toBe(false);
    expect(explainPrompt.argsSchema.safeParse({ visual_id: "" }).success).toBe(false);
  });
});

// S5 P4.B — per-prompt unit tests for the five new Magpie verbs.
// Each prompt gets 2 tests: arg validation + render shape.

describe("a11y_audit prompt (S5 P4.A)", () => {
  it("rejects missing visual_id and invalid target_level", () => {
    expect(a11yAuditPrompt.argsSchema.safeParse({}).success).toBe(false);
    expect(
      a11yAuditPrompt.argsSchema.safeParse({ visual_id: "v1", target_level: "A" }).success
    ).toBe(false);
  });

  it("renders XML body with WCAG level interpolated; defaults to AA", () => {
    const body = a11yAuditPrompt.render({ visual_id: "vis_abc" });
    expect(body).toContain("<instructions>");
    expect(body).toContain("<visual_context>\nmagpie://visual/vis_abc\n</visual_context>");
    expect(body).toContain("WCAG AA audit");
    const strict = a11yAuditPrompt.render({ visual_id: "vis_abc", target_level: "AAA" });
    expect(strict).toContain("WCAG AAA audit");
  });
});

describe("responsive_check prompt (S5 P4.A)", () => {
  it("rejects missing visual_id; accepts free-form breakpoints string", () => {
    expect(responsiveCheckPrompt.argsSchema.safeParse({}).success).toBe(false);
    expect(
      responsiveCheckPrompt.argsSchema.safeParse({
        visual_id: "v1",
        breakpoints: "320,480,1024",
      }).success
    ).toBe(true);
  });

  it("renders XML body with breakpoints; defaults to mobile/tablet/desktop", () => {
    const body = responsiveCheckPrompt.render({ visual_id: "v1" });
    expect(body).toContain("mobile,tablet,desktop");
    expect(body).toContain("magpie://visual/v1");
    expect(body).toContain("<task>");
  });
});

describe("dark_mode_port prompt (S5 P4.A)", () => {
  it("rejects missing visual_id", () => {
    expect(darkModePortPrompt.argsSchema.safeParse({}).success).toBe(false);
    expect(darkModePortPrompt.argsSchema.safeParse({ visual_id: "" }).success).toBe(false);
  });

  it("renders XML body warning against pure inversion and citing WCAG AA", () => {
    const body = darkModePortPrompt.render({ visual_id: "vis_xyz" });
    expect(body).toContain("Do not simply invert colors");
    expect(body).toContain("WCAG AA");
    expect(body).toContain("magpie://visual/vis_xyz");
  });
});

describe("simplify prompt (S5 P4.A)", () => {
  it("rejects missing visual_id; accepts optional dimension", () => {
    expect(simplifyPrompt.argsSchema.safeParse({}).success).toBe(false);
    expect(
      simplifyPrompt.argsSchema.safeParse({ visual_id: "v1", dimension: "color" }).success
    ).toBe(true);
  });

  it("renders XML body with dimension; defaults to hierarchy", () => {
    const body = simplifyPrompt.render({ visual_id: "v1" });
    expect(body).toContain("on this dimension: hierarchy");
    const colored = simplifyPrompt.render({ visual_id: "v1", dimension: "color" });
    expect(colored).toContain("on this dimension: color");
  });
});

describe("add_data prompt (S5 P4.A)", () => {
  it("rejects when either required arg is missing or empty", () => {
    expect(addDataPrompt.argsSchema.safeParse({ visual_id: "v1" }).success).toBe(false);
    expect(
      addDataPrompt.argsSchema.safeParse({ visual_id: "v1", data_description: "" }).success
    ).toBe(false);
  });

  it("renders XML body interpolating both data_description and visual_id", () => {
    const body = addDataPrompt.render({
      visual_id: "vis_abc",
      data_description: "B2B SaaS pricing tiers",
    });
    expect(body).toContain("B2B SaaS pricing tiers");
    expect(body).toContain("magpie://visual/vis_abc");
    expect(body).toContain("Preserve the visual's structure");
  });
});
