import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const figmaAdapter: Adapter = {
  name: "figma",
  matches(input: AdapterInput): boolean {
    return input.source === "figma";
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
