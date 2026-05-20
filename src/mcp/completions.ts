import { listProjects } from "../store/projects.js";
import { listAllVisuals, VISUAL_TYPE_VALUES } from "../store/visuals.js";

// v0.9.2 / Phase C / M8 — Spec 2025-11-25 `completions` capability per Owner
// decision iv. Three hooks: visual_id (resource template + prompt arg) ·
// project (tool/prompt arg) · type (tool/prompt arg). Hard cap N=20 results
// per request, prefix-filtered against argument.value. `logging` capability
// deferred to v0.9.3 (decision iv).

export const COMPLETIONS_MAX = 20;

export interface CompleteRef {
  type: "ref/prompt" | "ref/resource";
  name?: string;
  uri?: string;
}

export interface CompleteArgument {
  name: string;
  value: string;
}

export interface CompletionsPayload {
  completion: {
    values: string[];
    total: number;
    hasMore: boolean;
  };
}

function clampWithPrefix(all: string[], prefix: string): {
  values: string[];
  total: number;
  hasMore: boolean;
} {
  const p = prefix.toLowerCase();
  const matched = p.length === 0 ? all : all.filter((v) => v.toLowerCase().startsWith(p));
  const total = matched.length;
  const values = matched.slice(0, COMPLETIONS_MAX);
  return { values, total, hasMore: total > values.length };
}

function recentVisualIds(): string[] {
  return listAllVisuals().slice(0, 200).map((v) => v.id);
}

function projectNames(): string[] {
  return listProjects().map((p) => p.name);
}

function typeValues(): string[] {
  return [...VISUAL_TYPE_VALUES];
}

export function handleComplete(ref: CompleteRef, arg: CompleteArgument): CompletionsPayload {
  const value = arg.value ?? "";

  if (ref.type === "ref/resource" && typeof ref.uri === "string") {
    if (
      ref.uri === "magpie://visual/{id}" ||
      ref.uri.startsWith("magpie://visual/")
    ) {
      const payload = clampWithPrefix(recentVisualIds(), value);
      return { completion: payload };
    }
  }

  if (arg.name === "visual_id") {
    return { completion: clampWithPrefix(recentVisualIds(), value) };
  }
  if (arg.name === "project") {
    return { completion: clampWithPrefix(projectNames(), value) };
  }
  if (arg.name === "type") {
    return { completion: clampWithPrefix(typeValues(), value) };
  }

  return { completion: { values: [], total: 0, hasMore: false } };
}
