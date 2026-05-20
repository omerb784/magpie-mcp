import { describe, expect, it } from "vitest";
import { lintTemplate, type LintRule } from "./template-lint.js";
import type { References, VarSchema } from "./send-template-utils.js";

function rules(out: ReturnType<typeof lintTemplate>): LintRule[] {
  return out.map((w) => w.rule).sort();
}

describe("lintTemplate (S5 P2.C)", () => {
  it("returns [] for a clean schema'd template with task + visual_context", () => {
    const schema: VarSchema = [{ name: "tone", type: "string", required: true }];
    const body = `<instructions>Tighten copy.</instructions>
<visual_context>magpie://visual/{{id}}</visual_context>
<task>Make it {{tone}}.</task>`;
    expect(lintTemplate({ body, varSchema: schema })).toEqual([]);
  });

  it("fires undeclared_var when body uses a var not in schema", () => {
    const schema: VarSchema = [{ name: "tone", type: "string" }];
    const body = "Make it {{tone}} and {{mystery}} — ref {{id}}.";
    const out = rules(lintTemplate({ body, varSchema: schema }));
    expect(out).toContain("undeclared_var");
  });

  it("fires unused_var when schema declares a var the body never uses", () => {
    const schema: VarSchema = [
      { name: "tone", type: "string" },
      { name: "unused", type: "string" },
    ];
    const body = "Make it {{tone}} — ref {{id}}.";
    const out = rules(lintTemplate({ body, varSchema: schema }));
    expect(out).toContain("unused_var");
  });

  it("skips undeclared_var and unused_var when schema is null (legacy mustache)", () => {
    const body = "Make it {{anything}} — ref {{id}}.";
    const out = rules(lintTemplate({ body, varSchema: null }));
    expect(out).not.toContain("undeclared_var");
    expect(out).not.toContain("unused_var");
  });

  it("fires missing_task only for long bodies without <task>", () => {
    const longNoTask = "x".repeat(200) + " ref {{id}}";
    expect(rules(lintTemplate({ body: longNoTask, varSchema: null }))).toContain("missing_task");
    // Short body — don't nag.
    const shortNoTask = "make it dark — {{id}}";
    expect(rules(lintTemplate({ body: shortNoTask, varSchema: null }))).not.toContain("missing_task");
  });

  it("fires too_many_examples when >3 <example> blocks present", () => {
    const four = ["<example>a</example>", "<example>b</example>", "<example>c</example>", "<example>d</example>"].join("\n");
    const body = `pre {{id}} ${four}`;
    expect(rules(lintTemplate({ body, varSchema: null }))).toContain("too_many_examples");
    // Exactly 3 is fine.
    const three = ["<example>a</example>", "<example>b</example>", "<example>c</example>"].join("\n");
    const body3 = `pre {{id}} ${three}`;
    expect(rules(lintTemplate({ body: body3, varSchema: null }))).not.toContain("too_many_examples");
  });

  it("fires bare_assertion when assertion lacks both <visual_context> and {{id}}", () => {
    const body = "Make it dark mode and produce a list.";
    expect(rules(lintTemplate({ body, varSchema: null }))).toContain("bare_assertion");
  });

  it("does not fire bare_assertion when {{id}} anchors the visual", () => {
    const body = "Make it dark mode for visual {{id}}.";
    expect(rules(lintTemplate({ body, varSchema: null }))).not.toContain("bare_assertion");
  });

  describe("unreferenced_ref (S8 P8)", () => {
    const refs: References = [
      { name: "ref1", visual_id: "vis_style", visual_version: null },
    ];

    it("fires when a ref is set but the {{refN}} mustache is missing from body", () => {
      const body = "Improve visual {{id}}.";
      const out = rules(lintTemplate({ body, varSchema: null, references: refs }));
      expect(out).toContain("unreferenced_ref");
    });

    it("does not fire when every set ref appears in body via its mustache", () => {
      const body = "Mirror the style of {{ref1}} when iterating {{id}}.";
      const out = rules(lintTemplate({ body, varSchema: null, references: refs }));
      expect(out).not.toContain("unreferenced_ref");
    });

    it("skips silently when references is null or empty (legacy/free-prompt mode)", () => {
      const body = "Plain body {{id}}.";
      expect(rules(lintTemplate({ body, varSchema: null }))).not.toContain("unreferenced_ref");
      expect(rules(lintTemplate({ body, varSchema: null, references: null }))).not.toContain(
        "unreferenced_ref",
      );
      expect(rules(lintTemplate({ body, varSchema: null, references: [] }))).not.toContain(
        "unreferenced_ref",
      );
    });
  });
});
