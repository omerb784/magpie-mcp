import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const unknownAdapter: Adapter = {
  name: "unknown",
  matches(_input: AdapterInput): boolean {
    return false;
  },
  run(input: AdapterInput): AdapterOutput {
    return {
      content: input.content,
      title: null,
      status: "warn",
      error: "Content signature not recognized — saved as-is.",
    };
  },
};
