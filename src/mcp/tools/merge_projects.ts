import { z } from "zod";
import { mergeProjects } from "../../store/projects.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    src_name: z.string().min(1).max(120),
    dst_name: z.string().min(1).max(120),
  })
  .strict();

export const mergeProjectsTool: Tool<typeof argsSchema> = {
  name: "merge_projects",
  description: [
    "Move all visuals from src into dst, then archive src.",
    "Use when the user says 'merge X into Y', 'combine these projects', 'fold X into Y'.",
    "Both projects must exist and be non-archived. Operation is transactional.",
    "Returns the count of visuals moved.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      src_name: { type: "string", description: "Project to drain (will be archived after)." },
      dst_name: { type: "string", description: "Project to receive the visuals." },
    },
    required: ["src_name", "dst_name"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const r = mergeProjects(args.src_name, args.dst_name);
    if (!r.ok) return textResult(`Merge failed: ${r.reason}.`, true);
    notifyResourcesChanged();
    return textResult(
      `Merged "${args.src_name}" → "${args.dst_name}". Moved ${r.result.moved} visual(s); "${args.src_name}" archived.`
    );
  },
};
