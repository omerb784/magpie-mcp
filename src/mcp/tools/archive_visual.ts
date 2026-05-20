import { z } from "zod";
import { broadcast } from "../../http/ws.js";
import { archiveVisual, getVisual } from "../../store/visuals.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
  })
  .strict();

export const archiveVisualTool: Tool<typeof argsSchema> = {
  name: "archive_visual",
  description: [
    "Soft-delete a visual: hides from grid, search, and project views.",
    "Use when the user says 'remove', 'archive', 'hide', or 'I'm done with this one'.",
    "Reversible from the dashboard (project view → 'Show archived' → Restore). Versions and blobs kept.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: { type: "string", description: "ID returned by add_visual / iterate / find_visuals." },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const v = getVisual(args.visual_id);
    if (!v) return textResult(`Visual ${args.visual_id} not found.`, true);
    if (v.archived_at) {
      return textResult(
        `Visual ${v.id} is already archived. To restore: open the dashboard, select the project, toggle 'Show archived', then click Restore on the card.`
      );
    }

    archiveVisual(v.id);
    broadcast({ kind: "visual.updated", visual_id: v.id });
    notifyResourcesChanged();
    return textResult(
      `Archived "${v.title}" (${v.id}). To restore: open the dashboard, select the project, toggle 'Show archived', then click Restore on the card.`
    );
  },
};
