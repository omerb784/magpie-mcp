import { describe, expect, it } from "vitest";
import {
  approxTokens,
  classifyPill,
  cloneTitleFor,
  defaultsFromSchema,
  extractRefNames,
  extractVarNames,
  interpolate,
  MAX_VARS,
  nextRefSlot,
  pillClassNames,
  resolveReferences,
  splitInterpolation,
  SYSTEM_VARS,
  togglePin,
  type ReferenceItem,
  type References,
  type VarSchema,
} from "./send-template-utils.js";

const visual = { id: "ABC123", title: "Settings page", current_ver: 4 };

describe("extractVarNames", () => {
  it("returns user vars in order, deduped, system vars filtered", () => {
    const body = "Visit {{id}} v{{ver}} ({{title}}). Make it {{tone}} — {{change}} — keep {{tone}}.";
    expect(extractVarNames(body)).toEqual(["tone", "change"]);
  });

  it("returns empty for body with only system vars", () => {
    expect(extractVarNames("Show {{id}} ({{title}}, v{{ver}})")).toEqual([]);
  });

  it("ignores invalid var names", () => {
    expect(extractVarNames("{{Bad}} {{1bad}} {{a-b}} {{good}}")).toEqual(["good"]);
  });

  it("respects 16-char limit", () => {
    const tooLong = "a".repeat(17);
    expect(extractVarNames(`{{${tooLong}}} {{ok}}`)).toEqual(["ok"]);
  });

  it("can detect more than MAX_VARS — caller enforces cap", () => {
    const body = "{{a}} {{b}} {{c}} {{d}} {{e}} {{f}}";
    const vars = extractVarNames(body);
    expect(vars).toHaveLength(6);
    expect(vars.length > MAX_VARS).toBe(true);
  });
});

describe("interpolate", () => {
  it("substitutes system vars id/title/ver from visual", () => {
    const out = interpolate("Visit {{id}} ({{title}}, v{{ver}}).", visual, {});
    expect(out).toBe("Visit ABC123 (Settings page, v4).");
  });

  it("substitutes user vars from values map", () => {
    const out = interpolate("Make {{id}} {{tone}} — {{change}}.", visual, {
      tone: "minimal",
      change: "remove sidebar",
    });
    expect(out).toBe("Make ABC123 minimal — remove sidebar.");
  });

  it("preserves system vars even when user passes overlapping keys", () => {
    const out = interpolate("Visit {{id}} ({{title}}).", visual, { id: "EVIL", title: "EVIL" });
    expect(out).toBe("Visit ABC123 (Settings page).");
  });

  it("falls back to {{name}} placeholder when value missing/empty", () => {
    const out = interpolate("Make it {{tone}}.", visual, {});
    expect(out).toBe("Make it {{tone}}.");
    const empty = interpolate("Make it {{tone}}.", visual, { tone: "" });
    expect(empty).toBe("Make it {{tone}}.");
  });

  it("title falls back to 'untitled' when blank", () => {
    const out = interpolate("Show {{title}}.", { ...visual, title: "" }, {});
    expect(out).toBe("Show untitled.");
  });

  it("matches built-in Iterate output for full round-trip", () => {
    const body = "Iterate visual {{id}} ({{title}}, currently v{{ver}}) — make it {{change}}.";
    const out = interpolate(body, visual, { change: "dark theme" });
    expect(out).toBe(
      "Iterate visual ABC123 (Settings page, currently v4) — make it dark theme."
    );
  });

  it("matches built-in Variants output with count stepper value", () => {
    const body = "Generate {{count}} variants of visual {{id}} ({{title}}, currently v{{ver}}).";
    const out = interpolate(body, visual, { count: "5" });
    expect(out).toBe(
      "Generate 5 variants of visual ABC123 (Settings page, currently v4)."
    );
  });
});

describe("cloneTitleFor (built-in clone-on-edit)", () => {
  it("appends ' (custom)' suffix", () => {
    expect(cloneTitleFor("Iterate")).toBe("Iterate (custom)");
    expect(cloneTitleFor("Variants")).toBe("Variants (custom)");
    expect(cloneTitleFor("Explain")).toBe("Explain (custom)");
  });
});

describe("constants", () => {
  it("MAX_VARS is 5", () => {
    expect(MAX_VARS).toBe(5);
  });
  it("SYSTEM_VARS contains id, title, ver", () => {
    expect(SYSTEM_VARS.has("id")).toBe(true);
    expect(SYSTEM_VARS.has("title")).toBe(true);
    expect(SYSTEM_VARS.has("ver")).toBe(true);
    expect(SYSTEM_VARS.has("change")).toBe(false);
  });
});

describe("interpolate + refMap (S8 P4)", () => {
  it("ref1 alone resolves to magpie://visual/<id>", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_styleguide", visual_version: null },
    ];
    const { refMap } = resolveReferences("Use {{ref1}}.", refs);
    const out = interpolate("Use {{ref1}}.", visual, {}, refMap);
    expect(out).toBe("Use magpie://visual/vis_styleguide.");
  });

  it("ref1 + ref2 + ref3 all interpolate in body order", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_a", visual_version: null },
      { name: "ref2", visual_id: "vis_b", visual_version: null },
      { name: "ref3", visual_id: "vis_c", visual_version: null },
    ];
    const { refMap } = resolveReferences("[{{ref1}}] [{{ref2}}] [{{ref3}}]", refs);
    const out = interpolate(
      "[{{ref1}}] [{{ref2}}] [{{ref3}}]",
      visual,
      {},
      refMap,
    );
    expect(out).toBe(
      "[magpie://visual/vis_a] [magpie://visual/vis_b] [magpie://visual/vis_c]",
    );
  });

  it("pinned version uses /v<n> path in resolved URI", () => {
    const refs: References = [
      { name: "ref2", visual_id: "vis_locked", visual_version: 4 },
    ];
    const { refMap } = resolveReferences("see {{ref2}}", refs);
    const out = interpolate("see {{ref2}}", visual, {}, refMap);
    expect(out).toBe("see magpie://visual/vis_locked/v4");
  });

  it("unused ref doesn't appear in output (only what's in body lands)", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_used", visual_version: null },
      { name: "ref2", visual_id: "vis_unused", visual_version: null },
    ];
    const { refMap } = resolveReferences("only {{ref1}} here", refs);
    const out = interpolate("only {{ref1}} here", visual, {}, refMap);
    expect(out).toBe("only magpie://visual/vis_used here");
    expect(out).not.toContain("vis_unused");
  });
});

describe("extractRefNames (S8 P4.A)", () => {
  it("returns ref names in body order, deduped", () => {
    expect(extractRefNames("see {{ref1}}, {{ref2}}, {{ref1}}")).toEqual(["ref1", "ref2"]);
  });

  it("ignores non-ref vars", () => {
    expect(extractRefNames("{{id}} {{tone}} {{ref1}} {{ref4}}")).toEqual(["ref1"]);
  });

  it("returns empty when body has no refs", () => {
    expect(extractRefNames("Use {{tone}} on {{id}}.")).toEqual([]);
  });
});

describe("classifyPill + pillClassNames (S8 P6)", () => {
  it("classifies refs into the dedicated 'ref' kind", () => {
    expect(classifyPill("ref1")).toBe("ref");
    expect(classifyPill("ref2")).toBe("ref");
    expect(classifyPill("ref3")).toBe("ref");
  });

  it("classifies sys vars (id/title/ver) as 'sys'", () => {
    expect(classifyPill("id")).toBe("sys");
    expect(classifyPill("title")).toBe("sys");
    expect(classifyPill("ver")).toBe("sys");
  });

  it("classifies user vars as 'user'", () => {
    expect(classifyPill("tone")).toBe("user");
    expect(classifyPill("change")).toBe("user");
  });

  it("pillClassNames emits distinct class strings per kind, with active stacking", () => {
    expect(pillClassNames("ref1")).toBe("wb-varref ref");
    expect(pillClassNames("ref1", "ref1")).toBe("wb-varref ref active");
    expect(pillClassNames("id")).toBe("wb-varref sys");
    expect(pillClassNames("id", "id")).toBe("wb-varref sys active");
    expect(pillClassNames("tone")).toBe("wb-varref");
    expect(pillClassNames("tone", "tone")).toBe("wb-varref active");
  });
});

describe("nextRefSlot (S8 P5)", () => {
  it("returns ref1 when no refs exist", () => {
    expect(nextRefSlot([])).toBe("ref1");
  });

  it("returns ref2 when ref1 already taken (fills lowest gap)", () => {
    const refs: References = [{ name: "ref1", visual_id: "x", visual_version: null }];
    expect(nextRefSlot(refs)).toBe("ref2");
  });

  it("returns ref2 when ref1 + ref3 taken (fills lowest gap)", () => {
    const refs: References = [
      { name: "ref1", visual_id: "x", visual_version: null },
      { name: "ref3", visual_id: "z", visual_version: null },
    ];
    expect(nextRefSlot(refs)).toBe("ref2");
  });

  it("returns null when all three slots taken (caller hits cap)", () => {
    const refs: References = [
      { name: "ref1", visual_id: "x", visual_version: null },
      { name: "ref2", visual_id: "y", visual_version: null },
      { name: "ref3", visual_id: "z", visual_version: null },
    ];
    expect(nextRefSlot(refs)).toBeNull();
  });
});

describe("togglePin (S8 P5)", () => {
  const ref: ReferenceItem = { name: "ref1", visual_id: "v", visual_version: null };

  it("setting pin to true freezes visual_version to currentVer", () => {
    const out = togglePin(ref, 4, true);
    expect(out.visual_version).toBe(4);
  });

  it("setting pin to false clears visual_version to null (always-current)", () => {
    const pinned: ReferenceItem = { ...ref, visual_version: 4 };
    const out = togglePin(pinned, 4, false);
    expect(out.visual_version).toBeNull();
  });

  it("does not mutate input ref (returns new object)", () => {
    const out = togglePin(ref, 3, true);
    expect(out).not.toBe(ref);
    expect(ref.visual_version).toBeNull();
  });
});

describe("extractVarNames excludes refs (S8 P4.A)", () => {
  it("filters ref1/ref2/ref3 from user-var enumeration", () => {
    expect(extractVarNames("{{tone}} {{ref1}} {{change}}")).toEqual(["tone", "change"]);
  });
});

describe("resolveReferences (S8 P3.B)", () => {
  it("returns body unchanged + empty refMap when refs is null", () => {
    const out = resolveReferences("body {{ref1}}", null);
    expect(out.body).toBe("body {{ref1}}");
    expect(out.refMap).toEqual({});
  });

  it("builds magpie://visual/<id> when visual_version is null", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_alpha", visual_version: null },
    ];
    const out = resolveReferences("Use {{ref1}}.", refs);
    expect(out.refMap).toEqual({ ref1: "magpie://visual/vis_alpha" });
  });

  it("emits 3 refs with mixed pinned + live shapes", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_a", visual_version: null },
      { name: "ref2", visual_id: "vis_b", visual_version: 3 },
      { name: "ref3", visual_id: "vis_c", visual_version: 1 },
    ];
    const out = resolveReferences("ignored body", refs);
    expect(out.refMap).toEqual({
      ref1: "magpie://visual/vis_a",
      ref2: "magpie://visual/vis_b/v3",
      ref3: "magpie://visual/vis_c/v1",
    });
  });

  it("pinned version uses /v<n> path syntax matching parseMagpieUri", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_pin", visual_version: 7 },
    ];
    const out = resolveReferences("X", refs);
    expect(out.refMap.ref1).toBe("magpie://visual/vis_pin/v7");
  });
});

describe("approxTokens (S5 P2.B)", () => {
  it("returns 0 for empty string", () => {
    expect(approxTokens("")).toBe(0);
  });

  it("ceils chars / 4 — industry-rough estimate", () => {
    expect(approxTokens("a")).toBe(1);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});

describe("splitInterpolation (S5 P2.A)", () => {
  it("emits ordered text + var segments with system/user typing", () => {
    const body = "Visit {{id}} ({{title}}). Make it {{tone}}.";
    const out = splitInterpolation(body, visual, { tone: "concise" });
    expect(out).toEqual([
      { kind: "text", value: "Visit " },
      { kind: "var", name: "id", value: "ABC123", type: "system", filled: true },
      { kind: "text", value: " (" },
      { kind: "var", name: "title", value: "Settings page", type: "system", filled: true },
      { kind: "text", value: "). Make it " },
      { kind: "var", name: "tone", value: "concise", type: "user", filled: true },
      { kind: "text", value: "." },
    ]);
  });

  it("marks user var unfilled when missing/empty, keeps literal placeholder", () => {
    const out = splitInterpolation("Be {{tone}}.", visual, { tone: "" });
    expect(out).toEqual([
      { kind: "text", value: "Be " },
      { kind: "var", name: "tone", value: "{{tone}}", type: "user", filled: false },
      { kind: "text", value: "." },
    ]);
  });

  it("returns single text segment when body has no vars", () => {
    const out = splitInterpolation("Plain text only.", visual, {});
    expect(out).toEqual([{ kind: "text", value: "Plain text only." }]);
  });

  it("handles back-to-back vars without an intermediate text segment", () => {
    const out = splitInterpolation("{{id}}{{ver}}", visual, {});
    expect(out).toEqual([
      { kind: "var", name: "id", value: "ABC123", type: "system", filled: true },
      { kind: "var", name: "ver", value: "4", type: "system", filled: true },
    ]);
  });
});

describe("defaultsFromSchema (S5 P1.E)", () => {
  it("schema with required filled values interpolates correctly", () => {
    const schema: VarSchema = [
      { name: "tone", type: "string", required: true, default: "concise" },
    ];
    const defaults = defaultsFromSchema(schema);
    expect(defaults).toEqual({ tone: "concise" });
    const out = interpolate("Make {{id}} {{tone}}.", visual, defaults);
    expect(out).toBe("Make ABC123 concise.");
  });

  it("schema with no default + required leaves empty (renders as {{var}} placeholder)", () => {
    const schema: VarSchema = [{ name: "tone", type: "string", required: true }];
    const defaults = defaultsFromSchema(schema);
    expect(defaults.tone).toBe("");
    const out = interpolate("Make it {{tone}}.", visual, defaults);
    expect(out).toBe("Make it {{tone}}.");
  });

  it("enum type defaults to first option when no explicit default", () => {
    const schema: VarSchema = [
      { name: "mode", type: "enum", options: ["concise", "detailed", "playful"] },
    ];
    const defaults = defaultsFromSchema(schema);
    expect(defaults.mode).toBe("concise");
    const out = interpolate("Be {{mode}}.", visual, defaults);
    expect(out).toBe("Be concise.");
  });

  it("schema-less callers still interpolate via mustache (back-compat)", () => {
    // No schema → caller passes plain values map (matches legacy flow).
    const out = interpolate("Iterate {{id}} — make it {{change}}.", visual, {
      change: "dark mode",
    });
    expect(out).toBe("Iterate ABC123 — make it dark mode.");
  });
});
