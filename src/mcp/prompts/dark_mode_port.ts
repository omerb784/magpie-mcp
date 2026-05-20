import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
});

export const darkModePortPrompt: Prompt<typeof argsSchema> = {
  name: "dark_mode_port",
  description:
    "Port a light-themed Magpie visual to dark mode while preserving WCAG AA contrast. Translates color tokens, inverts backgrounds, recalibrates accent colors, and saves the new version via the iterate tool.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to port.",
      required: true,
    },
  ],
  argsSchema,
  render({ visual_id }) {
    return [
      "<instructions>",
      "You are porting an existing light-theme visual to dark mode.",
      "Preserve WCAG AA contrast (4.5:1 normal text, 3:1 large text and UI components).",
      "Do not simply invert colors. Recalibrate: dark backgrounds use #0a–#18 grays, not pure black; accent colors usually need slight desaturation + brightness lift to stay readable on dark.",
      "Keep the visual's structure, layout, and copy unchanged — only colors shift.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      "Port the visual above to dark mode. Steps:",
      `1. Read \`magpie://visual/${visual_id}\` to get the current content.`,
      "2. Identify the color palette in use (background, surface, text, mute, accent, success, error).",
      "3. For each color, propose a dark-mode counterpart that preserves contrast role.",
      "4. Produce the full updated body with the new palette applied.",
      `5. Call \`iterate(visual_id="${visual_id}", content="<dark-mode body>", message="dark mode port")\`.`,
      "6. Surface the preview URL Magpie returns.",
      "</task>",
    ].join("\n");
  },
};
