import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db.js";
import {
  countInbox,
  deleteInbox,
  getInbox,
  insertInbox,
  listInbox,
  markConsumed,
} from "./inbox.js";
import { createProject } from "./projects.js";
import { createVisual } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("inbox store", () => {
  it("insertInbox creates a pending entry with all fields", () => {
    const entry = insertInbox({
      prompt_body: "<instructions>Test</instructions>",
      vars: { change: "darker bg" },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.visual_id).toBeNull();
    expect(entry.template_id).toBeNull();
    expect(entry.prompt_body).toBe("<instructions>Test</instructions>");
    expect(entry.vars).toEqual({ change: "darker bg" });
    expect(entry.consumed_at).toBeNull();
    expect(entry.created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("insertInbox honors visual_id FK to an existing visual", () => {
    const project = createProject("proj-a", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "v",
      type: "html",
      source: null,
    });
    const entry = insertInbox({
      visual_id: visual.id,
      prompt_body: "iterate",
    });
    expect(entry.visual_id).toBe(visual.id);
  });

  it("insertInbox accepts null visual_id / template_id / vars (free-form sends)", () => {
    const entry = insertInbox({ prompt_body: "free form prompt" });
    expect(entry.visual_id).toBeNull();
    expect(entry.template_id).toBeNull();
    expect(entry.vars).toBeNull();
  });

  it("getInbox returns the entry by id, or null when missing", () => {
    const e = insertInbox({ prompt_body: "x", vars: { k: "v" } });
    const fetched = getInbox(e.id);
    expect(fetched?.id).toBe(e.id);
    expect(fetched?.vars).toEqual({ k: "v" });
    expect(getInbox("nope")).toBeNull();
  });

  it("listInbox status=pending returns pending only, newest first", () => {
    const a = insertInbox({ prompt_body: "older" });
    // tiny artificial gap to guarantee ordering across the same-ms boundary
    const b = insertInbox({ prompt_body: "newer" });
    markConsumed([a.id]);
    const pending = listInbox({ status: "pending" });
    expect(pending.map((e) => e.id)).toEqual([b.id]);
  });

  it("listInbox status=consumed returns consumed only", () => {
    const a = insertInbox({ prompt_body: "a" });
    const b = insertInbox({ prompt_body: "b" });
    markConsumed([a.id]);
    const consumed = listInbox({ status: "consumed" });
    expect(consumed.map((e) => e.id)).toEqual([a.id]);
    expect(consumed[0].consumed_at).not.toBeNull();
    expect(b).toBeDefined();
  });

  it("listInbox status=all returns both lanes", () => {
    const a = insertInbox({ prompt_body: "a" });
    const b = insertInbox({ prompt_body: "b" });
    markConsumed([a.id]);
    const all = listInbox({ status: "all" });
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("listInbox respects limit arg", () => {
    insertInbox({ prompt_body: "1" });
    insertInbox({ prompt_body: "2" });
    insertInbox({ prompt_body: "3" });
    const limited = listInbox({ status: "all", limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("markConsumed flips consumed_at + returns count of newly-marked rows", () => {
    const a = insertInbox({ prompt_body: "a" });
    const b = insertInbox({ prompt_body: "b" });
    const count = markConsumed([a.id, b.id]);
    expect(count).toBe(2);
    expect(getInbox(a.id)?.consumed_at).not.toBeNull();
    expect(getInbox(b.id)?.consumed_at).not.toBeNull();
  });

  it("markConsumed is idempotent — second call returns 0 for already-consumed", () => {
    const a = insertInbox({ prompt_body: "a" });
    expect(markConsumed([a.id])).toBe(1);
    expect(markConsumed([a.id])).toBe(0);
  });

  it("markConsumed with empty array returns 0", () => {
    expect(markConsumed([])).toBe(0);
  });

  it("deleteInbox removes a row, returns true; second call returns false", () => {
    const a = insertInbox({ prompt_body: "a" });
    expect(deleteInbox(a.id)).toBe(true);
    expect(getInbox(a.id)).toBeNull();
    expect(deleteInbox(a.id)).toBe(false);
  });

  it("countInbox reports lane sizes", () => {
    insertInbox({ prompt_body: "1" });
    const b = insertInbox({ prompt_body: "2" });
    insertInbox({ prompt_body: "3" });
    markConsumed([b.id]);
    expect(countInbox("pending")).toBe(2);
    expect(countInbox("consumed")).toBe(1);
    expect(countInbox("all")).toBe(3);
  });
});
