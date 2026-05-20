import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const stitchAdapter: Adapter = {
  name: "stitch",
  matches(input: AdapterInput): boolean {
    return input.source === "stitch";
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
