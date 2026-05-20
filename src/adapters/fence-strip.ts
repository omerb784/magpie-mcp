import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

const FENCE = /^\s*```(?:html|mermaid|svg|xml|dot|graphviz|json|vega|vega-lite|d2)?\s*\n([\s\S]*?)\n```\s*$/i;

export const fenceStripAdapter: Adapter = {
  name: "fence-strip",
  matches(input: AdapterInput): boolean {
    // Markdown visuals are allowed to contain fenced code blocks as legitimate content.
    if (input.type === "markdown") return false;
    return FENCE.test(input.content.trim());
  },
  run(input: AdapterInput): AdapterOutput {
    const m = FENCE.exec(input.content.trim());
    const inner = m?.[1] ?? input.content;
    return { content: inner, title: null, status: "ok" };
  },
};
