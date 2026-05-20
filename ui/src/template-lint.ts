// S5 P2.C — template lint engine (pure-fn, warn-only per Q4=A).
// Rules grounded in research findings F3 (Promptfoo + Palantir + Lakera 2026).
// Most prompt failures are ambiguity-driven, not model limits — surface
// the 5 most common authoring mistakes before Send. Never block; warnings
// expand on click in the lint bar (P2.D).

import {
  extractRefNames,
  extractVarNames,
  type References,
  type VarSchema,
} from "./send-template-utils.js";

export type LintRule =
  | "undeclared_var"
  | "unused_var"
  | "missing_task"
  | "too_many_examples"
  | "bare_assertion"
  // S8 P8.A — warns when a ref row is set but the corresponding
  // `{{refN}}` is missing from the body. Warn-only; send fires (R13).
  | "unreferenced_ref";

export interface LintWarning {
  rule: LintRule;
  message: string;
  hint: string;
}

// <task>...</task> case-insensitive, multiline-tolerant.
const TASK_RE = /<task\b[^>]*>[\s\S]*?<\/task>/i;
// <example>...</example> blocks — count occurrences.
const EXAMPLE_RE = /<example\b[^>]*>[\s\S]*?<\/example>/gi;
// <visual_context>...</visual_context> presence check.
const VISUAL_CONTEXT_RE = /<visual_context\b[^>]*>[\s\S]*?<\/visual_context>/i;
// {{id}} reference — alternative to <visual_context> for built-in style.
const ID_REF_RE = /\{\{id\}\}/;
// Bare-assertion heuristic: imperative phrasing markers.
const ASSERTION_RE = /\b(be\s+\w+|make\s+it\s+\w+|ensure\s+\w+|produce\s+\w+)\b/i;

// Threshold below which we don't nag for missing_task — short prompts are
// often free-form one-liners where structured XML is overkill.
const MISSING_TASK_MIN_LEN = 120;
const TOO_MANY_EXAMPLES_CAP = 3;

export function lintTemplate(args: {
  body: string;
  varSchema: VarSchema | null;
  // S8 P8.A — references slot. Optional so callers without refs
  // (legacy callers, free-prompt mode) skip the new rule cleanly.
  references?: References | null;
}): LintWarning[] {
  const { body, varSchema, references } = args;
  const warnings: LintWarning[] = [];

  const usedVars = new Set(extractVarNames(body));

  // Rule 1+2 — only meaningful when a schema is declared. Schema-less
  // templates are legacy mustache; the body itself is the source of truth.
  if (varSchema) {
    const declared = new Set(varSchema.map((v) => v.name));
    // 1. undeclared_var — body references a var the schema doesn't declare.
    for (const used of usedVars) {
      if (!declared.has(used)) {
        warnings.push({
          rule: "undeclared_var",
          message: `\`{{${used}}}\` in body but not in schema`,
          hint: "Add it to the Variables panel or remove from body.",
        });
      }
    }
    // 2. unused_var — schema declares a var the body never uses.
    for (const decl of declared) {
      if (!usedVars.has(decl)) {
        warnings.push({
          rule: "unused_var",
          message: `\`${decl}\` declared in schema but never used in body`,
          hint: `Use the "↑ insert in body" button on the row, or remove the row.`,
        });
      }
    }
  }

  // 3. missing_task — long prompt without <task> structure.
  if (body.length >= MISSING_TASK_MIN_LEN && !TASK_RE.test(body)) {
    warnings.push({
      rule: "missing_task",
      message: "Body is long but has no <task>...</task> block",
      hint: "Wrap the action in <task> tags so the LLM parses it unambiguously.",
    });
  }

  // 4. too_many_examples — past the F4 sweet spot quality collapses.
  const exampleMatches = body.match(EXAMPLE_RE);
  const exampleCount = exampleMatches ? exampleMatches.length : 0;
  if (exampleCount > TOO_MANY_EXAMPLES_CAP) {
    warnings.push({
      rule: "too_many_examples",
      message: `${exampleCount} <example> blocks · cap is ${TOO_MANY_EXAMPLES_CAP}`,
      hint: "Past 3 examples, LLM output quality degrades (research: arXiv 2509.13196).",
    });
  }

  // 5. bare_assertion — assertion-y phrasing without anchoring the visual.
  if (
    ASSERTION_RE.test(body) &&
    !VISUAL_CONTEXT_RE.test(body) &&
    !ID_REF_RE.test(body)
  ) {
    warnings.push({
      rule: "bare_assertion",
      message: "Body asserts behavior but never references the visual",
      hint: "Add <visual_context>magpie://visual/{{id}}</visual_context> or include {{id}} so the LLM has a target.",
    });
  }

  // 6. unreferenced_ref (S8) — a ref row is set but its `{{refN}}` mustache
  // isn't in the body. Warn-only per R13/R16 — send still fires; refs the
  // body doesn't reference simply don't appear in the resolved output.
  if (references && references.length > 0) {
    const used = new Set(extractRefNames(body));
    for (const ref of references) {
      if (!used.has(ref.name)) {
        warnings.push({
          rule: "unreferenced_ref",
          message: `Reference \`{{${ref.name}}}\` set but not used in body`,
          hint: `Add \`{{${ref.name}}}\` to the body to inject the reference, or remove the row from the References panel.`,
        });
      }
    }
  }

  return warnings;
}
