import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  dimension: z.string().min(1).optional(),
});

export const simplifyPrompt: Prompt<typeof argsSchema> = {
  name: "simplify",
  description:
    "Reduce visual complexity along a chosen dimension. Removes redundant elements, tightens hierarchy, or flattens color/density — depending on the dimension — then saves the simplified version via the iterate tool.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to simplify.",
      required: true,
    },
    {
      name: "dimension",
      description: "Which axis to simplify on. Free-form. Examples: 'hierarchy', 'color', 'content density', 'animation', 'copy'. Defaults to 'hierarchy'.",
      required: false,
    },
  ],
  argsSchema,
  render({ visual_id, dimension }) {
    const dim = dimension ?? "hierarchy";
    return [
      "<instructions>",
      "You are simplifying an existing visual along a specific dimension.",
      "Simplify = remove, not rearrange. Strip what does not earn its place.",
      "Preserve the visual's core purpose. Identify it before cutting — if you cut the purpose, you've gone too far.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Simplify the visual above on this dimension: ${dim}.`,
      "",
      "Dimension playbook:",
      "- 'hierarchy' → flatten heading levels, drop redundant containers, merge similar sections.",
      "- 'color' → reduce palette to ≤4 colors total, drop decorative tints, keep semantic colors.",
      "- 'content density' → cut filler copy, shorten labels, drop redundant icons.",
      "- 'animation' → remove anything non-functional, keep transitions that signal state changes.",
      "- 'copy' → cut by 30% minimum, prefer concrete nouns, drop adjectives.",
      "",
      "Steps:",
      `1. Read \`magpie://visual/${visual_id}\`.`,
      "2. Name what gets cut and why (one line each).",
      "3. Produce the full simplified body.",
      `4. Call \`iterate(visual_id="${visual_id}", content="<simplified body>", message="simplify: ${dim}")\`.`,
      "</task>",
    ].join("\n");
  },
};
