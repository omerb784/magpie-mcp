import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  data_description: z.string().min(1),
});

export const addDataPrompt: Prompt<typeof argsSchema> = {
  name: "add_data",
  description:
    "Replace lorem-ipsum / placeholder content in a Magpie visual with realistic data matching a description. Preserves layout, only swaps text/numbers/labels for plausible domain-specific values.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to populate.",
      required: true,
    },
    {
      name: "data_description",
      description: "What the realistic data should represent. Free-form. Examples: 'B2B SaaS pricing tiers', 'fitness app workout history for one user over a week', 'CRM contact list with 8 fake leads'.",
      required: true,
    },
  ],
  argsSchema,
  render({ visual_id, data_description }) {
    return [
      "<instructions>",
      "You are replacing placeholder content in an existing visual with realistic, domain-specific data.",
      "Preserve the visual's structure, layout, classes, and styles. Only swap text, numbers, and labels.",
      "Realistic = plausible, not random. Names should fit the locale. Numbers should follow real-world distributions.",
      "Do not invent new sections, columns, or rows beyond what already exists.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Populate the visual above with realistic data representing: ${data_description}`,
      "",
      "Steps:",
      `1. Read \`magpie://visual/${visual_id}\`.`,
      "2. Inventory every text / number / label that's currently placeholder (lorem ipsum, 'Item 1', '$X.XX', 'Name', etc).",
      "3. Replace each with a plausible value matching the description above.",
      "4. Maintain visual consistency — if there were 5 rows, return 5 rows; do not add or drop entries.",
      "5. Produce the full updated body with replacements applied.",
      `6. Call \`iterate(visual_id="${visual_id}", content="<populated body>", message="add data: ${data_description}")\`.`,
      "</task>",
    ].join("\n");
  },
};
