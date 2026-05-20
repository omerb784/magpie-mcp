import { z } from "zod";
import { getBaseUrl } from "../../runtime.js";
import { searchVisuals, VISUAL_TYPE_VALUES } from "../../store/visuals.js";
import { SOURCE_VALUES } from "../source.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    query: z.string().max(200).optional(),
    match_description: z.boolean().optional(),
    project: z.string().max(120).optional(),
    tag: z.string().max(40).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    type: z.enum(VISUAL_TYPE_VALUES).optional(),
    source: z.enum(SOURCE_VALUES).optional(),
    starred: z.boolean().optional(),
  })
  .strict();

export const findVisualsTool: Tool<typeof argsSchema> = {
  name: "find_visuals",
  description: [
    "Search the user's visual library across all projects.",
    "Use to find / look up / locate prior work, or filter by tag, source, type, project, starred.",
    "Filters compose AND. All optional — call with no args for most-recent.",
    "`query` matches partial title (case-insensitive). `match_description: true` also matches description. `project` is exact. `tags` is array of exact names (AND). `tag` (singular) is deprecated.",
    "Hard cap 200 rows. Returns table: id · title · project · type · v · tags · preview URL.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Partial match on visual title (case-insensitive). When match_description=true, also matches against the visual's description." },
      match_description: {
        type: "boolean",
        description: "When true, `query` matches partial title OR description. Defaults false (title-only). Set true when the user's natural-language search is about intent (\"the auth flow doc\") rather than label.",
      },
      project: { type: "string", description: "Exact project name." },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Exact tag names. Multiple tags compose AND (e.g. ['wip', 'approved']).",
      },
      tag: {
        type: "string",
        description: "Deprecated. Use `tags: [name]` instead. Kept for backwards compatibility.",
      },
      type: {
        type: "string",
        enum: [...VISUAL_TYPE_VALUES],
        description: "Filter by visual type.",
      },
      source: {
        type: "string",
        enum: [...SOURCE_VALUES],
        description: "Filter by generator source (e.g. 'stitch', 'figma').",
      },
      starred: { type: "boolean", description: "Only starred visuals when true." },
    },
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const rows = searchVisuals(args);
    const tagDeprecated = args.tag !== undefined && (!args.tags || args.tags.length === 0);
    const deprecationLine = tagDeprecated
      ? `Note: \`tag\` (singular) is deprecated. Use \`tags: ["${args.tag}"]\` instead.`
      : null;

    if (rows.length === 0) {
      const body = "No matches. Try dropping a tag/source/type filter, or call list_projects to see what exists.";
      return textResult(deprecationLine ? `${deprecationLine}\n${body}` : body);
    }
    const base = getBaseUrl();
    const TYPE_W = 11;
    const header = "id".padEnd(28) + "title".padEnd(32) + "project".padEnd(20) + "type".padEnd(TYPE_W) + "v".padEnd(4) + "tags".padEnd(28) + "preview";
    const sep = "-".repeat(28) + "-".repeat(32) + "-".repeat(20) + "-".repeat(TYPE_W) + "-".repeat(4) + "-".repeat(28) + "-------";
    const lines = rows.map((r) => {
      const id = r.id.padEnd(28);
      const title = truncate(r.title, 30).padEnd(32);
      const project = truncate(r.project_name, 18).padEnd(20);
      const type = r.type.padEnd(TYPE_W);
      const ver = String(r.current_ver).padEnd(4);
      const tags = truncate(r.tag_names || "", 26).padEnd(28);
      const preview = `${base}/v/${r.id}`;
      return `${id}${title}${project}${type}${ver}${tags}${preview}`;
    });
    const table = [header, sep, ...lines].join("\n");
    return textResult(deprecationLine ? `${deprecationLine}\n\n${table}` : table);
  },
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
