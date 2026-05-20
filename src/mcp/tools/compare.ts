import { z } from "zod";
import { getBaseUrl } from "../../runtime.js";
import { listForVisual } from "../../store/versions.js";
import { getVisual } from "../../store/visuals.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
    a: z.number().int().min(1).optional(),
    b: z.number().int().min(1).optional(),
  })
  .strict();

export const compareTool: Tool<typeof argsSchema> = {
  name: "compare",
  description: [
    "Diff two versions of the same visual side-by-side in a browser.",
    "Use after `iterate`, or on 'before/after', 'compare v2 and v3', 'diff this'.",
    "Defaults: a = current_ver - 1, b = current_ver.",
    "Returns URL only (no textual diff — page renders both panes in iframes).",
    "For a textual diff, read both versions via `magpie://visual/<id>/v{n}` and compare in the model.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: { type: "string", description: "ID returned by add_visual / iterate / find_visuals." },
      a: { type: "integer", description: "Left pane version number. Defaults to current_ver - 1." },
      b: { type: "integer", description: "Right pane version number. Defaults to current_ver." },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const v = getVisual(args.visual_id);
    if (!v) return textResult(`Visual ${args.visual_id} not found.`, true);

    const a = args.a ?? Math.max(1, v.current_ver - 1);
    const b = args.b ?? v.current_ver;
    if (a === b) {
      return textResult(
        `a and b are both v${a}. Pick two different versions to compare.`,
        true
      );
    }

    const versions = listForVisual(v.id);
    const have = new Set(versions.map((x) => x.version_num));
    if (!have.has(a)) return textResult(`Version ${a} not found for visual ${v.id}.`, true);
    if (!have.has(b)) return textResult(`Version ${b} not found for visual ${v.id}.`, true);

    const url = `${getBaseUrl()}/compare/${v.id}?a=${a}&b=${b}`;
    return textResult(
      `Compare v${a} ↔ v${b} of "${v.title}":\n${url}\nOpen this URL in your browser — side-by-side iframes render v${a} on the left, v${b} on the right.`
    );
  },
};
