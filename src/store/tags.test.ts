import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db.js";
import { createProject } from "./projects.js";
import { attachTag, ensureTag, setVisualTags, tagColorFor, tagsForVisual } from "./tags.js";
import { createVisual } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("tags store", () => {
  it("ensureTag creates once + reuses", () => {
    const a = ensureTag("approved");
    const b = ensureTag("approved");
    expect(a.id).toBe(b.id);
    expect(a.color).toMatch(/^hsl\(/);
  });

  it("tagColorFor is deterministic per name", () => {
    expect(tagColorFor("wip")).toBe(tagColorFor("wip"));
    expect(tagColorFor("wip")).not.toBe(tagColorFor("final"));
  });

  it("attachTag is idempotent (no duplicate join rows)", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    const t = ensureTag("wip");
    attachTag(v.id, t.id);
    attachTag(v.id, t.id);
    expect(tagsForVisual(v.id).map((x) => x.name)).toEqual(["wip"]);
  });

  it("setVisualTags REPLACES the tag set transactionally", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    setVisualTags(v.id, ["wip", "draft"]);
    expect(tagsForVisual(v.id).map((t) => t.name).sort()).toEqual(["draft", "wip"]);

    setVisualTags(v.id, ["final"]);
    expect(tagsForVisual(v.id).map((t) => t.name)).toEqual(["final"]);

    setVisualTags(v.id, []);
    expect(tagsForVisual(v.id)).toEqual([]);
  });
});
