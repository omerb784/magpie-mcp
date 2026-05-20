import { addVisualTool } from "./add_visual.js";
import { archiveProjectTool } from "./archive_project.js";
import { archiveVisualTool } from "./archive_visual.js";
import { compareTool } from "./compare.js";
import { createProjectTool } from "./create_project.js";
import { findVisualsTool } from "./find_visuals.js";
import { iterateTool } from "./iterate.js";
import { listProjectsTool } from "./list_projects.js";
import { listVersionsTool } from "./list_versions.js";
import { mergeProjectsTool } from "./merge_projects.js";
import { openPreviewTool } from "./open_preview.js";
import { readInboxTool } from "./read_inbox.js";
import { updateProjectTool } from "./update_project.js";
import { updateVisualTool } from "./update_visual.js";
import type { Tool } from "../types.js";

export const TOOLS: Tool[] = [
  createProjectTool,
  addVisualTool,
  iterateTool,
  findVisualsTool,
  compareTool,
  openPreviewTool,
  updateVisualTool,
  archiveVisualTool,
  archiveProjectTool,
  updateProjectTool,
  mergeProjectsTool,
  listProjectsTool,
  listVersionsTool,
  readInboxTool,
];

export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t])
);
