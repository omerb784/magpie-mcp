import { z } from "zod";
import { getBaseUrl } from "../../runtime.js";
import { listForVisual } from "../../store/versions.js";
import { getVisual } from "../../store/visuals.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
  })
  .strict();

export const LIST_VERSIONS_CAP = 200;

export const listVersionsTool: Tool<typeof argsSchema> = {
  name: "list_versions",
  description: [
    "List all versions of a single visual, oldest to newest.",
    "Use when the user asks for the history of a specific visual (\"show versions\", \"history of this\").",
    "Returns a text table — version, render status, iteration message, created_at — plus a compare URL nudge when ≥ 2 versions exist.",
    `Hard cap ${LIST_VERSIONS_CAP} rows; overflow surfaces as a "+N more — open dashboard" tail line.`,
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: { type: "string", description: "ID of the visual to inspect." },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const visual = getVisual(args.visual_id);
    if (!visual) {
      return textResult(
        `Visual ${args.visual_id} not found. Use the id returned by add_visual / iterate / find_visuals.`,
        true
      );
    }
    const all = listForVisual(args.visual_id);
    if (all.length === 0) {
      return textResult(
        `Visual ${args.visual_id} exists but has no versions on disk — likely a stale row. Open the dashboard to inspect.`,
        true
      );
    }
    const rows = all.slice(0, LIST_VERSIONS_CAP);
    const overflow = all.length - rows.length;
    const lines = [
      `History for "${visual.title}" (${visual.id}):`,
      "ver  render   message                                  created_at",
      "---  ------   -------                                  ----------",
      ...rows.map(
        (r) =>
          `${String(r.version_num).padEnd(5)}${r.render_status.padEnd(9)}${(r.message ?? "").slice(0, 40).padEnd(41)}${r.created_at}`
      ),
    ];
    if (rows.length >= 2) {
      const a = rows[rows.length - 2]?.version_num;
      const b = rows[rows.length - 1]?.version_num;
      lines.push(
        `\nDiff latest two: compare(visual_id: "${visual.id}") → ${getBaseUrl()}/compare/${visual.id}?a=${a}&b=${b}`
      );
    }
    if (overflow > 0) {
      lines.push(`\n+${overflow} more version(s) — open the dashboard for the full history.`);
    }
    return textResult(lines.join("\n"));
  },
};
