import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db.js";
import { createProject } from "./projects.js";
import {
  appendVersion,
  listForVisual,
  nextVersionNum,
  setRenderStatus,
} from "./versions.js";
import { createVisual } from "./visuals.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

describe("versions store", () => {
  it("appendVersion creates pending row at next number", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    expect(nextVersionNum(v.id)).toBe(1);

    const v1 = appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/tmp/v1.html",
      message: null,
    });
    expect(v1.render_status).toBe("pending");
    expect(v1.thumb_path).toBeNull();
    expect(nextVersionNum(v.id)).toBe(2);

    appendVersion({
      visual_id: v.id,
      version_num: 2,
      content_path: "/tmp/v2.html",
      message: "darker",
    });
    const all = listForVisual(v.id);
    expect(all.map((x) => x.version_num)).toEqual([1, 2]);
    expect(all[1]?.message).toBe("darker");
  });

  it("appendVersion round-trips per-version description (v0.9.2 Phase A)", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/tmp/v1.html",
      message: "initial",
      description: null,
    });
    appendVersion({
      visual_id: v.id,
      version_num: 2,
      content_path: "/tmp/v2.html",
      message: "added TOC",
      description: "Reorganized for guide use. Sticky TOC, full R ledger grouped by theme.",
    });
    const all = listForVisual(v.id);
    expect(all[0]?.description).toBeNull();
    expect(all[1]?.description).toContain("Reorganized for guide use");
  });

  it("appendVersion description defaults to NULL when omitted", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    const ver = appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/tmp/v1.html",
      message: null,
    });
    expect(ver.description).toBeNull();
    expect(listForVisual(v.id)[0]?.description).toBeNull();
  });

  it("setRenderStatus updates row in place", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    const ver = appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/tmp/v1.html",
      message: null,
    });
    setRenderStatus({
      version_id: ver.id,
      status: "ok",
      thumb_path: "/tmp/v1.png",
      error: null,
    });
    const got = listForVisual(v.id)[0]!;
    expect(got.render_status).toBe("ok");
    expect(got.thumb_path).toBe("/tmp/v1.png");

    setRenderStatus({
      version_id: ver.id,
      status: "failed",
      thumb_path: null,
      error: "boom",
    });
    const failed = listForVisual(v.id)[0]!;
    expect(failed.render_status).toBe("failed");
    expect(failed.render_error).toBe("boom");
  });

  it("UNIQUE (visual_id, version_num) constraint blocks duplicate inserts", () => {
    const p = createProject("p", "mockup");
    const v = createVisual({ project_id: p.id, title: "x", type: "html", source: null });
    appendVersion({
      visual_id: v.id,
      version_num: 1,
      content_path: "/tmp/v1.html",
      message: null,
    });
    expect(() =>
      appendVersion({
        visual_id: v.id,
        version_num: 1,
        content_path: "/tmp/v1b.html",
        message: null,
      })
    ).toThrow();
  });
});
