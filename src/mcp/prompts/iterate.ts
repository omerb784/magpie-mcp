import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  direction: z.string().min(1),
});

export const iteratePrompt: Prompt<typeof argsSchema> = {
  name: "iterate",
  description:
    "Refine an existing Magpie visual in a specific direction. Loads the current content and asks the model to produce a new full version, then save it via the iterate tool.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to refine (from find_visuals or a previous tool call).",
      required: true,
    },
    {
      name: "direction",
      description: "What to change. Free-form, e.g. 'make it dark mode', 'remove the sidebar', 'switch to vertical layout'.",
      required: true,
    },
  ],
  argsSchema,
  render({ visual_id, direction }) {
    return [
      "<instructions>",
      "You are refining an existing visual stored in Magpie.",
      "Magpie does not generate content — you do.",
      "Load the current content via the resource below, propose a refined full version (never a diff),",
      "then save the new version with the `iterate` tool.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Refine the visual above in this direction: ${direction}`,
      "",
      "Steps:",
      `1. Read the resource \`magpie://visual/${visual_id}\` to get the current content.`,
      "2. Produce the full refined content (always the entire body, never a patch).",
      `3. Call \`iterate(visual_id="${visual_id}", content="<new full body>", message="<one-line summary of the change>")\`.`,
      "4. Surface the preview URL Magpie returns so the user can review.",
      "</task>",
    ].join("\n");
  },
};
