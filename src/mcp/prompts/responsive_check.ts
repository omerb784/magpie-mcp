import { z } from "zod";
import type { Prompt } from "./types.js";

const argsSchema = z.object({
  visual_id: z.string().min(1),
  breakpoints: z.string().min(1).optional(),
});

export const responsiveCheckPrompt: Prompt<typeof argsSchema> = {
  name: "responsive_check",
  description:
    "Check a Magpie visual at named breakpoints (mobile / tablet / desktop) and propose adaptations. Identifies broken layouts, overflow, illegible text sizes, and missing touch targets, then returns concrete fixes.",
  arguments: [
    {
      name: "visual_id",
      description: "The Magpie visual id to check.",
      required: true,
    },
    {
      name: "breakpoints",
      description: "Comma-separated breakpoint names or widths. Defaults to 'mobile,tablet,desktop' (375px, 768px, 1280px).",
      required: false,
    },
  ],
  argsSchema,
  render({ visual_id, breakpoints }) {
    const bps = breakpoints ?? "mobile,tablet,desktop";
    return [
      "<instructions>",
      "You are checking an existing visual's responsiveness across viewports.",
      "Reason as if you were resizing a browser window at each breakpoint.",
      "For each issue, provide a concrete CSS / markup patch — no generic advice.",
      "</instructions>",
      "",
      "<visual_context>",
      `magpie://visual/${visual_id}`,
      "</visual_context>",
      "",
      "<task>",
      `Check the visual above at these breakpoints: ${bps}.`,
      "Default widths: mobile=375px, tablet=768px, desktop=1280px (override if breakpoint name implies a different size).",
      "",
      "Cover per breakpoint:",
      "1. Layout integrity (no horizontal scroll, no clipped content, grid/flex reflow sensible).",
      "2. Type legibility (body ≥14px on mobile, line-length ≤75ch).",
      "3. Touch targets (interactive elements ≥44×44px on mobile).",
      "4. Image / media scaling (max-width:100%, aspect-ratio preserved).",
      "5. Navigation pattern (hamburger / drawer / off-canvas where appropriate).",
      "",
      "Output format:",
      "- One section per breakpoint with findings + code patches.",
      "- End with: 'Apply combined fixes via iterate(visual_id, content=...).'",
      "</task>",
    ].join("\n");
  },
};
