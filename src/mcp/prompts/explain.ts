import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  audience: z.string().min(1).optional(),
});

export const explainPrompt: Prompt<typeof argsSchema> = {
  name: "explain",
  description:
    "Walk through an existing Magpie visual in prose — structure, content, intent, edge cases. Read-only: produces an explanation, does not modify the visual.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to explain.",
      required: true,
    },
    {
      name: "audience",
      description: "Who the explanation is for. Free-form, e.g. 'developer', 'designer', 'PM', 'first-time reviewer'. Defaults to 'developer'.",
      required: false,
    },
  ],
  argsSchema,
  render({ visual_id, audience }) {
    const who = audience ?? "developer";
    return [
      "<instructions>",
      "You are reading an existing Magpie visual and explaining it in prose.",
      "Do NOT call `iterate` or `add_visual` — this is a read-only walkthrough.",
      "Load the content via the resource below.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Explain the visual above to a ${who}.`,
      "",
      "Cover:",
      "- What it is (type, top-level structure).",
      "- The main parts / regions / nodes, in reading order.",
      "- Intent or design rationale you can infer.",
      "- Anything notable: edge cases, conditional states, dependencies, gaps.",
      "",
      "Keep it tight. Bullets over paragraphs where helpful. End with one suggestion the user could iterate on.",
      "</task>",
    ].join("\n");
  },
};
