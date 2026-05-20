import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const plainAdapter: Adapter = {
  name: "plain",
  matches(_input: AdapterInput): boolean {
    return true;
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
