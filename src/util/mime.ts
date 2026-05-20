import type { VisualType } from "../store/visuals.js";

export function mimeForType(t: VisualType): string {
  if (t === "html") return "text/html";
  if (t === "svg") return "image/svg+xml";
  if (t === "markdown") return "text/markdown";
  if (t === "dot") return "text/vnd.graphviz";
  if (t === "vega-lite") return "application/vnd.vega.v5+json";
  if (t === "d2") return "text/x-d2";
  return "text/x-mermaid";
}

export function rendersToSvg(t: VisualType): boolean {
  return t === "svg" || t === "dot" || t === "vega-lite" || t === "d2";
}
