import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const svgmakerAdapter: Adapter = {
  name: "svgmaker",
  matches(input: AdapterInput): boolean {
    return input.source === "svgmaker";
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
