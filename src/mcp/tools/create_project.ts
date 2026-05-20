import { z } from "zod";
import {
  createProject as createProjectStore,
  DESCRIPTION_MAX,
  findByName,
} from "../../store/projects.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(["mockup", "diagram", "mixed"]),
    description: z.string().max(DESCRIPTION_MAX).optional(),
  })
  .strict();

export const createProjectTool: Tool<typeof argsSchema> = {
  name: "create_project",
  description: [
    "Create a new named project bucket in the user's Magpie library.",
    "Use when the user explicitly wants an empty project set up before adding visuals.",
    "Most of the time skip this — add_visual auto-creates a project if its `project` arg is unknown.",
    "Returns text confirmation. Idempotent: if a project with the same name exists, the response says 'Reusing'.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Unique project name. One project per app/feature/client. Reuse names already mentioned in this chat.",
      },
      type: {
        type: "string",
        enum: ["mockup", "diagram", "mixed"],
        description:
          "'mockup' for UI screens (HTML), 'diagram' for Mermaid sources, 'mixed' for both.",
      },
      description: {
        type: "string",
        description:
          "Optional short paragraph (≤2000 chars) describing what this project holds. Surfaces in list_projects / dashboard sidebar tooltip / resource JSON.",
      },
    },
    required: ["name", "type"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const existing = findByName(args.name);
    const project =
      existing ?? createProjectStore(args.name, args.type, args.description ?? null);
    const created = !existing;
    if (created) notifyResourcesChanged();
    const verb = created ? "Created" : "Reusing";
    return textResult(
      `${verb} project "${project.name}" (type ${project.type}).\nNext: add_visual(project: "${project.name}", type: "html" | "mermaid" | "svg" | "markdown" | "dot" | "vega-lite" | "d2", content: ...).`
    );
  },
};
