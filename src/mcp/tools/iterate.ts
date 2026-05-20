import { z } from "zod";
import { normalize } from "../../adapters/index.js";
import { config } from "../../config.js";
import { broadcast } from "../../http/ws.js";
import { enqueueRender } from "../../render/index.js";
import { getBaseUrl } from "../../runtime.js";
import { writeBlob } from "../../store/blobs.js";
import { DESCRIPTION_MAX } from "../../store/projects.js";
import { appendVersion, nextVersionNum, waitForRender } from "../../store/versions.js";
import { bumpCurrentVersion, getVisual } from "../../store/visuals.js";
import { readContentPath } from "../../util/path-guard.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const RENDER_WAIT_MS = 5000;

const argsSchema = z
  .object({
    visual_id: z.string().min(1),
    content: z.string().min(1).optional(),
    content_path: z.string().min(1).optional(),
    message: z.string().max(500).optional(),
    description: z.string().max(DESCRIPTION_MAX).optional(),
  })
  .strict()
  .refine(
    (a) => Boolean(a.content) !== Boolean(a.content_path),
    { message: "Provide exactly one of `content` or `content_path` (not both, not neither)." }
  );

export const iterateTool: Tool<typeof argsSchema> = {
  name: "iterate",
  description: [
    "Append a new version to an EXISTING visual.",
    "Use when the user wants to refine / rework a visual you produced earlier (\"make it dark mode\", \"v2\").",
    "Provide FULL new content — never a diff. Saved as vN+1; current_ver bumps.",
    "Pass `content` or `content_path` (preferred for iterate — regenerating full body inline wastes tokens).",
    "Type inherits from the existing visual; cannot change format on iterate.",
    "Returns preview URL + compare URL.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      visual_id: {
        type: "string",
        description: "ID of the existing visual to extend. From a previous tool response.",
      },
      content: {
        type: "string",
        description: "FULL new content, inline. Up to 5MB. Prefer `content_path`.",
      },
      content_path: {
        type: "string",
        description:
          "Absolute local file path. Preferred for iterate. Must be under MAGPIE_CONTENT_ROOT (= caller project root by default).",
      },
      message: {
        type: "string",
        description:
          "Short one-line version note (≤500 chars). For longer rationale use `description`. Example: \"dark mode\".",
      },
      description: {
        type: "string",
        description:
          "Long-form rationale for this version (≤2000 chars). Shown in version history. Set-once at iterate time (no edit in v0.9.2).",
      },
    },
    required: ["visual_id"],
    additionalProperties: false,
  },
  argsSchema,
  async handler(args) {
    let rawContent: string;
    if (args.content_path) {
      const r = readContentPath(args.content_path);
      if (!r.ok) {
        return textResult(`content_path rejected (${r.code}): ${r.message}`, true);
      }
      rawContent = r.content;
    } else if (args.content) {
      if (Buffer.byteLength(args.content, "utf8") > config.maxContentBytes) {
        return textResult(
          `Content exceeds ${config.maxContentBytes} bytes. Trim it or split into multiple visuals.`,
          true
        );
      }
      rawContent = args.content;
    } else {
      return textResult("Provide either content or content_path.", true);
    }

    const visual = getVisual(args.visual_id);
    if (!visual) {
      return textResult(
        `Unknown visual_id: ${args.visual_id}. Use the id returned by your last add_visual call.`,
        true
      );
    }

    const out = normalize({
      content: rawContent,
      type: visual.type,
      source: visual.source,
    });
    if (out.status === "failed") {
      return textResult(`Adapter rejected content: ${out.error ?? "unknown"}`, true);
    }

    const next = nextVersionNum(visual.id);
    const contentPath = writeBlob({
      visual_id: visual.id,
      version_num: next,
      type: visual.type,
      content: out.content,
    });
    const version = appendVersion({
      visual_id: visual.id,
      version_num: next,
      content_path: contentPath,
      message: args.message ?? null,
      description: args.description ?? null,
    });
    bumpCurrentVersion(visual.id, next);

    enqueueRender({
      visual_id: visual.id,
      version_id: version.id,
      version_num: next,
      type: visual.type,
      content_path: contentPath,
    });

    broadcast({ kind: "version.added", visual_id: visual.id, version_num: next });
    notifyResourcesChanged();

    const renderState = await waitForRender(version.id, RENDER_WAIT_MS);
    const base = getBaseUrl();
    const previewUrl = `${base}/v/${visual.id}`;
    const compareUrl = `${base}/compare/${visual.id}?a=${next - 1}&b=${next}`;
    const lines = [
      `"${visual.title}" (${visual.id}) updated to v${next}.`,
      `Preview: ${previewUrl}`,
      "Open this URL in your browser to view the rendered preview.",
      `Compare v${next - 1} ↔ v${next}: ${compareUrl}`,
      `Magpie ref: magpie://visual/${visual.id}`,
    ];
    if (out.status === "warn") {
      lines.push(`Note: ${out.error ?? "adapter flagged content"}`);
    }
    lines.push(formatRenderLine(renderState));
    return textResult(lines.join("\n"));
  },
};

function formatRenderLine(state: { status: string; error: string | null }): string {
  if (state.status === "ok") return "Render: ok.";
  if (state.status === "warn") {
    return `Render: warn — ${state.error ?? "see dashboard"}.`;
  }
  if (state.status === "failed") {
    return `Render: failed — ${state.error ?? "see dashboard"}. Fix the source and call iterate(...) to re-render.`;
  }
  return "Render: pending — refresh the dashboard if the thumbnail is missing.";
}
