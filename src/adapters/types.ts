import type { Source, VisualType } from "../store/visuals.js";

export type AdapterStatus = "ok" | "warn" | "failed";

export interface AdapterInput {
  content: string;
  type: VisualType;
  source: Source | null;
}

export interface AdapterOutput {
  content: string;
  title: string | null;
  status: AdapterStatus;
  error?: string;
}

export interface Adapter {
  name: string;
  matches(input: AdapterInput): boolean;
  run(input: AdapterInput): AdapterOutput;
}
