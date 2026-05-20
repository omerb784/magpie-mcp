import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  count: z.coerce.number().int().min(2).max(6).optional(),
  dimension: z.string().min(1).optional(),
});

export const variantsPrompt: Prompt<typeof argsSchema> = {
  name: "variants",
  description:
    "Fan out N alternative versions of an existing Magpie visual along a chosen dimension (layout / color / tone / density). Each variant saves through the iterate tool so all alternatives live as versions of the same visual.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to fan out.",
      required: true,
    },
    {
      name: "count",
      description: "How many variants to produce (2-6, default 3).",
      required: false,
    },
    {
      name: "dimension",
      description: "What axis the variants explore. Free-form, e.g. 'color palette', 'information density', 'layout direction'. Defaults to 'overall style'.",
      required: false,
    },
  ],
  argsSchema,
  render({ visual_id, count, dimension }) {
    const n = count ?? 3;
    const dim = dimension ?? "overall style";
    return [
      "<instructions>",
      "You are fanning out alternative versions of an existing Magpie visual.",
      "Each variant must be a full self-contained body (never a diff).",
      "Save each variant as a new version of the same visual via the `iterate` tool — Magpie auto-increments the version number.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Produce ${n} distinct variants of the visual above, differing along this dimension: ${dim}.`,
      "",
      "Steps:",
      `1. Read \`magpie://visual/${visual_id}\` to get the baseline content.`,
      `2. For each of the ${n} variants:`,
      `   - Produce a full alternative body that meaningfully differs in ${dim}.`,
      `   - Call \`iterate(visual_id="${visual_id}", content="<variant body>", message="variant N/${n}: <one-line label>")\`.`,
      "3. After all variants are saved, surface the compare URL so the user can review side-by-side.",
      "</task>",
    ].join("\n");
  },
};
