import { z } from "zod";
import { getBaseUrl } from "../../runtime.js";
import { listForVisual } from "../../store/versions.js";
import { getVisual } from "../../store/visuals.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
    version: z.number().int().min(1).optional(),
  })
  .strict();

export const openPreviewTool: Tool<typeof argsSchema> = {
  name: "open_preview",
  description: [
    "Return a browser URL to reach back to an existing visual.",
    "Use when the user asks 'open it', 'show me', 'where is it' for a visual from earlier in the chat, a prior session, or after `find_visuals`.",
    "Default surface is the LIBRARY view (`/?visual=<id>`) — project selected, drawer auto-opened.",
    "Pass `version` to deep-link a historical version (switches to `/v/<id>?ver=N`).",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: { type: "string", description: "ID returned by add_visual / iterate / find_visuals." },
      version: { type: "integer", description: "Version number. Defaults to the current version." },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    const v = getVisual(args.visual_id);
    if (!v) return textResult(`Visual ${args.visual_id} not found.`, true);

    const ver = args.version ?? v.current_ver;
    const versions = listForVisual(v.id);
    if (!versions.find((x) => x.version_num === ver)) {
      return textResult(`Version ${ver} not found for visual ${v.id}.`, true);
    }

    const versionPassed = args.version !== undefined;
    const url = versionPassed
      ? `${getBaseUrl()}/v/${v.id}?ver=${ver}`
      : `${getBaseUrl()}/?visual=${v.id}`;
    return textResult(
      `"${v.title}" v${ver}:\n${url}\nOpen this URL in your browser to view it.`
    );
  },
};
