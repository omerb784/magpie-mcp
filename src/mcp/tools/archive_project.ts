import { z } from "zod";
import { archiveProject, findArchivedByName, findByName } from "../../store/projects.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    name: z.string().min(1).max(120),
  })
  .strict();

export const archiveProjectTool: Tool<typeof argsSchema> = {
  name: "archive_project",
  description: [
    "Soft-delete a project: hides it from list_projects and the dashboard sidebar.",
    "Use when the user says 'archive this project', 'I'm done with X', 'hide that project'.",
    "Visuals inside are not deleted — they're still archived per-row alongside the project.",
    "Reversible from the dashboard's Archived view.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact project name." },
    },
    required: ["name"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const project = findByName(args.name);
    if (!project) {
      const archived = findArchivedByName(args.name);
      if (archived) {
        return textResult(
          `Project "${args.name}" is already archived. Open the dashboard's Archived view to restore.`
        );
      }
      return textResult(`Project "${args.name}" not found.`, true);
    }
    archiveProject(args.name);
    notifyResourcesChanged();
    return textResult(
      `Archived project "${args.name}". To restore: open the dashboard sidebar → Archived view.`
    );
  },
};
