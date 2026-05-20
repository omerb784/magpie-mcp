import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  target_level: z.enum(["AA", "AAA"]).optional(),
});

export const a11yAuditPrompt: Prompt<typeof argsSchema> = {
  name: "a11y_audit",
  description:
    "Audit a Magpie visual against WCAG accessibility guidelines and propose patches. Loads the current content, surfaces failures (contrast, ARIA, semantics, focus order, alt text), and returns concrete code fixes.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to audit.",
      required: true,
    },
    {
      name: "target_level",
      description: "WCAG conformance level. 'AA' (default) or 'AAA' for stricter checks.",
      required: false,
    },
  ],
  argsSchema,
  render({ visual_id, target_level }) {
    const level = target_level ?? "AA";
    return [
      "<instructions>",
      `You are auditing an existing visual stored in Magpie against WCAG ${level} accessibility guidelines.`,
      "Be specific. Cite the WCAG criterion number for each finding (e.g. 1.4.3 Contrast Minimum).",
      "For each failure, provide the exact code patch that resolves it — not a description.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Perform a WCAG ${level} audit of the visual above. Cover at minimum:`,
      "1. Color contrast (text vs background, interactive vs background).",
      "2. Semantic HTML (headings hierarchy, landmark roles, lists, buttons vs divs).",
      "3. ARIA attributes (labels, roles, states — only when native semantics are insufficient).",
      "4. Keyboard navigation (focus order, focus indicators, skip links, no keyboard traps).",
      "5. Non-text content (alt text on images, accessible names on icons).",
      "6. Forms (labels, error association, required state, instructions).",
      "",
      "Output format:",
      "- One section per failure: WCAG criterion, brief problem, exact code patch.",
      "- End with: 'Apply via iterate(visual_id, content=...) when the user approves.'",
      "</task>",
    ].join("\n");
  },
};
