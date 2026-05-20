import { z } from "zod";
import {
  DESCRIPTION_MAX,
  findByName,
  renameProject,
  setProjectDescription,
} from "../../store/projects.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    old_name: z.string().min(1).max(120),
    new_name: z.string().min(1).max(120).optional(),
    description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  })
  .strict()
  .refine(
    (a) => a.new_name !== undefined || a.description !== undefined,
    { message: "Pass at least one of `new_name` or `description`." }
  );

export const updateProjectTool: Tool<typeof argsSchema> = {
  name: "update_project",
  description: [
    "Edit a project: rename, set/clear description, or both.",
    "Use when the user says 'rename project X to Y', 'describe project X as ...', 'call this Z and note that it's for ...'.",
    "`new_name` must be unique among non-archived projects when supplied. `description` is ≤2000 chars; pass null to clear; omit to leave as-is.",
    "Renaming preserves all visuals — only the project label changes. Idempotent: yields '(no change)' when neither field actually differs from current.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      old_name: { type: "string", description: "Current project name." },
      new_name: {
        type: "string",
        description: "New project name. Omit to keep current. Must not collide with an existing non-archived project.",
      },
      description: {
        type: ["string", "null"],
        description:
          "New description (≤2000 chars). Pass null to clear. Omit to leave current description in place.",
      },
    },
    required: ["old_name"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const project = findByName(args.old_name);
    if (!project) return textResult(`Project "${args.old_name}" not found.`, true);

    const renameRequested = args.new_name !== undefined && args.new_name !== args.old_name;
    const descChangeRequested =
      args.description !== undefined && args.description !== project.description;
    const applied: string[] = [];

    if (renameRequested) {
      const r = renameProject(args.old_name, args.new_name!);
      if (!r.ok) return textResult(`Rename failed: ${r.reason}.`, true);
      applied.push(`renamed → "${args.new_name}"`);
    }
    if (descChangeRequested) {
      setProjectDescription(project.id, args.description ?? null);
      applied.push(args.description === null ? "description cleared" : "description updated");
    }

    if (applied.length === 0) {
      return textResult(`Updated project "${args.old_name}" (no change).`);
    }

    notifyResourcesChanged();
    return textResult(
      `Updated project "${args.old_name}" → ${applied.join(", ")}.`
    );
  },
};
