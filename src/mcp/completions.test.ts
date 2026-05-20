import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { createProject } from "../store/projects.js";
import { createVisual, VISUAL_TYPE_VALUES } from "../store/visuals.js";
import { COMPLETIONS_MAX, handleComplete } from "./completions.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("completions capability · v0.9.2 Phase C / M8 (decision iv)", () => {
  it("ref/resource on magpie://visual/{id} → returns recent visual ids, capped at N=20", () => {
    const proj = createProject("p", "mockup");
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(
        createVisual({ project_id: proj.id, title: `t${i}`, type: "html", source: null }).id
      );
    }
    const res = handleComplete(
      { type: "ref/resource", uri: "magpie://visual/{id}" },
      { name: "id", value: "" }
    );
    expect(res.completion.values.length).toBe(COMPLETIONS_MAX);
    expect(res.completion.total).toBe(25);
    expect(res.completion.hasMore).toBe(true);
    for (const v of res.completion.values) {
      expect(ids).toContain(v);
    }
  });

  it("argument.name === 'project' → returns project names, prefix-filtered", () => {
    createProject("alpha", "mockup");
    createProject("alphabet", "diagram");
    createProject("beta", "mixed");
    const res = handleComplete(
      { type: "ref/prompt", name: "anything" },
      { name: "project", value: "alph" }
    );
    expect(res.completion.values.sort()).toEqual(["alpha", "alphabet"]);
    expect(res.completion.total).toBe(2);
    expect(res.completion.hasMore).toBe(false);
  });

  it("argument.name === 'type' → returns the 7 format enum values", () => {
    const res = handleComplete(
      { type: "ref/prompt", name: "anything" },
      { name: "type", value: "" }
    );
    expect(res.completion.values).toEqual([...VISUAL_TYPE_VALUES]);
    expect(res.completion.total).toBe(7);
    expect(res.completion.hasMore).toBe(false);
  });

  it("argument.name === 'type' with prefix 'm' filters to mermaid + markdown", () => {
    const res = handleComplete(
      { type: "ref/prompt", name: "anything" },
      { name: "type", value: "m" }
    );
    expect(res.completion.values.sort()).toEqual(["markdown", "mermaid"]);
  });

  it("unknown argument.name falls through to empty completion", () => {
    const res = handleComplete(
      { type: "ref/prompt", name: "x" },
      { name: "unknown_arg", value: "" }
    );
    expect(res.completion.values).toEqual([]);
    expect(res.completion.total).toBe(0);
    expect(res.completion.hasMore).toBe(false);
  });
});
