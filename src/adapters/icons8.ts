import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";

export const icons8Adapter: Adapter = {
  name: "icons8",
  matches(input: AdapterInput): boolean {
    return input.source === "icons8";
  },
  run(input: AdapterInput): AdapterOutput {
    return { content: input.content, title: null, status: "ok" };
  },
};
