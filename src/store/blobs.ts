import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { VisualType } from "./visuals.js";

export function extFor(
  type: VisualType
): "html" | "mmd" | "svg" | "md" | "dot" | "vl.json" | "d2" {
  if (type === "html") return "html";
  if (type === "mermaid") return "mmd";
  if (type === "markdown") return "md";
  if (type === "dot") return "dot";
  if (type === "vega-lite") return "vl.json";
  if (type === "d2") return "d2";
  return "svg";
}

export function blobPath(visual_id: string, version_num: number, type: VisualType): string {
  return join(config.blobsRoot, visual_id, `v${version_num}.${extFor(type)}`);
}

export function writeBlob(args: {
  visual_id: string;
  version_num: number;
  type: VisualType;
  content: string;
}): string {
  const dir = join(config.blobsRoot, args.visual_id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = blobPath(args.visual_id, args.version_num, args.type);
  writeFileSync(path, args.content, "utf8");
  return path;
}
