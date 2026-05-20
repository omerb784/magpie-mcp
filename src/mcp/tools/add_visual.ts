import { z } from "zod";
import { normalize } from "../../adapters/index.js";
import { broadcast } from "../../http/ws.js";
import { enqueueRender } from "../../render/index.js";
import { getBaseUrl } from "../../runtime.js";
import { writeBlob } from "../../store/blobs.js";
import { config } from "../../config.js";
import {
  createProject,
  DESCRIPTION_MAX,
  findByName,
  type ProjectType,
} from "../../store/projects.js";
import { attachTag, ensureTag } from "../../store/tags.js";
import { appendVersion, waitForRender } from "../../store/versions.js";
import { createVisual, type VisualType } from "../../store/visuals.js";
import { readContentPath } from "../../util/path-guard.js";
import { notifyResourcesChanged } from "../notifications.js";
import { SOURCE_VALUES } from "../source.js";
import { type Tool, textResult } from "../types.js";

const RENDER_WAIT_MS = 5000;

const argsSchema = z
  .object({
    project: z.string().min(1).max(120),
    type: z.enum(["html", "mermaid", "svg", "markdown", "dot", "vega-lite", "d2"]),
    content: z.string().min(1).optional(),
    content_path: z.string().min(1).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(DESCRIPTION_MAX).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    source: z.enum(SOURCE_VALUES).optional(),
  })
  .strict()
  .refine(
    (a) => Boolean(a.content) !== Boolean(a.content_path),
    { message: "Provide exactly one of `content` or `content_path` (not both, not neither)." }
  );

export const addVisualTool: Tool<typeof argsSchema> = {
  name: "add_visual",
  description: [
    "Save a NEW visual (html, mermaid, svg, markdown, dot, vega-lite, d2) as v1 of a new visual entity.",
    "Use when the user wants to mock / draft / sketch / draw / diagram / chart / write something fresh, or add a new screen alongside existing ones.",
    "Pass exactly one of `content` (inline) or `content_path` (absolute local file, preferred for non-trivial size).",
    "Auto-creates project. Returns visual_id + preview URL.",
    "Always-insert contract: each call creates a NEW visual_id, even with identical args. Pass an existing id to `iterate` to extend rather than duplicate.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project name. Reuse if mentioned. Auto-created if new." },
      type: {
        type: "string",
        enum: ["html", "mermaid", "svg", "markdown", "dot", "vega-lite", "d2"],
        description:
          "'html' for UI mockups, 'mermaid' for diagrams, 'svg' for icons/logos, 'markdown' for prose/docs/READMEs, 'dot' for Graphviz graphs (digraph/graph), 'vega-lite' for charts/data viz (JSON spec), 'd2' for D2 diagrams.",
      },
      content: {
        type: "string",
        description: "Full artifact source, inline. Up to 5MB. Prefer `content_path` for non-trivial size.",
      },
      content_path: {
        type: "string",
        description:
          "Absolute local file path. Preferred over `content`. Must be under MAGPIE_CONTENT_ROOT (= caller project root by default). Bytes copied at call time; later source edits don't affect saved versions.",
      },
      title: { type: "string", description: "Short label. Auto-extracted if omitted." },
      description: {
        type: "string",
        description:
          "Short paragraph (≤2000 chars) capturing intent — what it's for, what state it represents. Surfaces in find_visuals (match_description=true), drawer, resource JSON.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tag names. Conventions: 'wip', 'final', 'approved'.",
      },
      source: {
        type: "string",
        enum: [...SOURCE_VALUES],
        description: "Generator that produced this. Set only when chaining from a generator MCP.",
      },
    },
    required: ["project", "type"],
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

    const out = normalize({
      content: rawContent,
      type: args.type,
      source: args.source ?? null,
    });
    if (out.status === "failed") {
      return textResult(`Adapter rejected content: ${out.error ?? "unknown"}`, true);
    }

    const existingProject = findByName(args.project);
    const project =
      existingProject ?? createProject(args.project, deriveProjectType(args.type));

    const title = args.title ?? out.title ?? "Untitled";
    const visual = createVisual({
      project_id: project.id,
      title,
      type: args.type,
      source: args.source ?? null,
      description: args.description ?? null,
    });

    const contentPath = writeBlob({
      visual_id: visual.id,
      version_num: 1,
      type: args.type,
      content: out.content,
    });

    const version = appendVersion({
      visual_id: visual.id,
      version_num: 1,
      content_path: contentPath,
      message: null,
    });

    if (args.tags && args.tags.length > 0) {
      for (const name of args.tags) {
        const t = ensureTag(name);
        attachTag(visual.id, t.id);
      }
    }

    enqueueRender({
      visual_id: visual.id,
      version_id: version.id,
      version_num: 1,
      type: args.type,
      content_path: contentPath,
    });

    broadcast({ kind: "visual.created", visual_id: visual.id });
    notifyResourcesChanged();

    const renderState = await waitForRender(version.id, RENDER_WAIT_MS);
    const previewUrl = `${getBaseUrl()}/v/${visual.id}`;
    const lines = [
      `Saved "${title}" as visual ${visual.id} v1 in project "${project.name}".`,
      `Preview: ${previewUrl}`,
      "Open this URL in your browser to view the rendered preview.",
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

function deriveProjectType(visualType: VisualType): ProjectType {
  if (visualType === "html") return "mockup";
  if (visualType === "markdown" || visualType === "vega-lite" || visualType === "svg") {
    return "mixed";
  }
  return "diagram";
}
