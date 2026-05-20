import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const mermaidChartAdapter: Adapter = {
  name: "mermaid-chart",
  matches(input: AdapterInput): boolean {
    return input.source === "mermaid-chart";
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
