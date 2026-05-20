import { z } from "zod";
import { broadcast } from "../../http/ws.js";
import { DESCRIPTION_MAX } from "../../store/projects.js";
import { setVisualTags, tagsForVisual } from "../../store/tags.js";
import { getVisual, setVisualDescription, updateVisualMeta } from "../../store/visuals.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    starred: z.boolean().optional(),
  })
  .strict();

export const updateVisualTool: Tool<typeof argsSchema> = {
  name: "update_visual",
  description: [
    "Edit metadata on an existing visual: rename, edit description, replace tag set, toggle starred.",
    "Use when the user says 'rename it', 'describe it as X', 'tag it as Y', 'star this', 'unstar', 'mark final'.",
    "`tags` REPLACES the full tag set (not append). Pass [] to clear all tags. Pass `description: null` to clear the description.",
    "Idempotent. Returns the updated row summary; appends '(no change)' when the patch matches current state.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: { type: "string", description: "ID returned by add_visual / iterate / find_visuals." },
      title: { type: "string", description: "New title. Omit to keep the current title." },
      description: {
        type: ["string", "null"],
        description:
          "New description (≤2000 chars). Pass null to clear. Omit to leave the current description in place.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Replace tag set. Pass empty array to clear. Omit to keep tags as-is.",
      },
      starred: { type: "boolean", description: "Set true to star, false to unstar. Omit to keep current." },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const v = getVisual(args.visual_id);
    if (!v) return textResult(`Visual ${args.visual_id} not found.`, true);

    if (
      args.title === undefined &&
      args.description === undefined &&
      args.tags === undefined &&
      args.starred === undefined
    ) {
      return textResult(
        "Nothing to update — pass at least one of title, description, tags, starred.",
        true
      );
    }

    const beforeTags = tagsForVisual(v.id).map((t) => t.name).sort();
    const beforeStarred = Boolean(v.starred);
    const titleChanged = args.title !== undefined && args.title !== v.title;
    const descriptionChanged =
      args.description !== undefined && args.description !== v.description;
    const starredChanged = args.starred !== undefined && args.starred !== beforeStarred;
    const tagsChanged =
      args.tags !== undefined &&
      !sameTagSet(beforeTags, [...args.tags].map((t) => t).sort());
    const noChange = !titleChanged && !descriptionChanged && !starredChanged && !tagsChanged;

    if (args.title !== undefined || args.starred !== undefined) {
      updateVisualMeta({
        visual_id: v.id,
        title: args.title,
        starred: args.starred,
      });
    }
    if (args.description !== undefined) {
      setVisualDescription(v.id, args.description);
    }
    if (args.tags !== undefined) {
      setVisualTags(v.id, args.tags);
    }

    broadcast({ kind: "visual.updated", visual_id: v.id });
    notifyResourcesChanged();

    const updated = getVisual(v.id);
    const tagNames = tagsForVisual(v.id).map((t) => t.name).join(", ") || "—";
    const star = updated?.starred ? "★" : "☆";
    const desc = updated?.description ?? "—";
    const suffix = noChange ? " (no change)" : "";
    return textResult(
      `Updated visual ${v.id}${suffix}.\nTitle: ${updated?.title}\nDescription: ${desc}\nStarred: ${star}\nTags: ${tagNames}`
    );
  },
};

function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
