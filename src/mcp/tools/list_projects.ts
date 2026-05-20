import { z } from "zod";
import { listProjects } from "../../store/projects.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z.object({}).strict();

export const LIST_PROJECTS_CAP = 200;

export const listProjectsTool: Tool<typeof argsSchema> = {
  name: "list_projects",
  description: [
    "List all of the user's projects with type, visual counts, and last-activity timestamps.",
    "Use when the user asks what's in their library, \"what projects do I have\", \"show my work\", or before deciding which project a new visual belongs in.",
    "Returns a text table — name, type, visual count, last activity.",
    `Hard cap ${LIST_PROJECTS_CAP} rows (recency-ordered); overflow surfaces as a "+N more — open dashboard" tail line.`,
  ].join(" "),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  argsSchema,
  handler() {
    const all = listProjects();
    if (all.length === 0) {
      return textResult(
        "No projects yet. Ask the user what they'd like to create, then call add_visual — Magpie auto-creates the project."
      );
    }
    const rows = all.slice(0, LIST_PROJECTS_CAP);
    const overflow = all.length - rows.length;
    const lines = [
      "name                          type     visuals  last_activity",
      "----                          ----     -------  -------------",
      ...rows.map(
        (r) =>
          `${r.name.padEnd(30)}${r.type.padEnd(9)}${String(r.visual_count).padEnd(9)}${r.last_activity}`
      ),
    ];
    if (overflow > 0) {
      lines.push(`\n+${overflow} more project(s) — open the dashboard for the full library.`);
    }
    return textResult(lines.join("\n"));
  },
};
