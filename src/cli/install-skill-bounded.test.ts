import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill } from "./install-skill.js";

const TARGET_REL = ".claude/skills/magpie-master/SKILL.md";

let HOME = "";
let BUNDLED = "";
let BUNDLED_PATH = "";

function bundled(version: string, body = "body"): string {
  return `---\nname: magpie-master\ndescription: trigger magpie nest\nversion: ${version}\n---\n\n# Master\n\n${body}\n`;
}

interface FsSnapshot {
  files: Map<string, number>; // path → mtime ms
}

function snapshot(root: string): FsSnapshot {
  const files = new Map<string, number>();
  if (!existsSync(root)) return { files };
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(p);
      else files.set(p, s.mtimeMs);
    }
  };
  walk(root);
  return { files };
}

interface FsDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

function diff(before: FsSnapshot, after: FsSnapshot): FsDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [p, mt] of after.files) {
    if (!before.files.has(p)) added.push(p);
    else if ((before.files.get(p) ?? 0) !== mt) modified.push(p);
  }
  for (const p of before.files.keys()) {
    if (!after.files.has(p)) removed.push(p);
  }
  return { added, modified, removed };
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "magpie-bounded-home-"));
  BUNDLED = mkdtempSync(resolve(tmpdir(), "magpie-bounded-bundled-"));
  BUNDLED_PATH = resolve(BUNDLED, "SKILL.md");
  writeFileSync(BUNDLED_PATH, bundled("0.9.2", "bundled-body"), "utf8");
});

afterEach(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  if (BUNDLED && existsSync(BUNDLED)) rmSync(BUNDLED, { recursive: true, force: true });
});

describe("installSkill bounded-write audit (v0.9.2 Phase B/S6)", () => {
  it("copied path: writes exactly one new file at the exact expected target", () => {
    mkdirSync(resolve(HOME, ".claude"), { recursive: true });
    const expectedTarget = resolve(HOME, TARGET_REL);

    const before = snapshot(HOME);
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(result.status).toBe("copied");
    expect(d.added).toEqual([expectedTarget]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("noop-same path: zero filesystem changes (hash matches)", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bundled("0.9.2", "bundled-body"), "utf8");

    const before = snapshot(HOME);
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(result.status).toBe("noop-same");
    expect(d.added).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("refused-edited path: zero filesystem changes (owner edit preserved)", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bundled("0.9.2", "owner-edit"), "utf8");

    const before = snapshot(HOME);
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(result.status).toBe("refused-edited");
    expect(d.added).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("unknown-host path: zero filesystem changes (~/.claude/ missing, prints manual instructions only)", () => {
    const before = snapshot(HOME);
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(result.status).toBe("unknown-host");
    expect(d.added).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("upgraded path: modifies exactly one file at the exact expected target", async () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bundled("0.9.0", "older"), "utf8");
    // Force a noticeable mtime gap so the diff reliably catches the rewrite.
    await new Promise((r) => setTimeout(r, 15));

    const before = snapshot(HOME);
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(result.status).toBe("upgraded");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    // Exactly one file modified — the target.
    expect(d.modified).toEqual([target]);
  });

  it("target path is deterministic — under HOME, exactly .claude/skills/magpie-master/SKILL.md", () => {
    mkdirSync(resolve(HOME, ".claude"), { recursive: true });
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.target).toBe(resolve(HOME, TARGET_REL));
    expect(result.target.startsWith(HOME)).toBe(true);
    const segments = result.target.split(sep);
    expect(segments).toContain(".claude");
    expect(segments).toContain("skills");
    expect(segments).toContain("magpie-master");
    expect(segments[segments.length - 1]).toBe("SKILL.md");
  });

  it("does not touch unrelated ~/.claude/ subtree (other skills survive)", () => {
    mkdirSync(resolve(HOME, ".claude"), { recursive: true });
    const otherSkill = resolve(HOME, ".claude/skills/other-skill/SKILL.md");
    mkdirSync(dirname(otherSkill), { recursive: true });
    writeFileSync(otherSkill, "other content", "utf8");

    const before = snapshot(HOME);
    installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    const after = snapshot(HOME);
    const d = diff(before, after);

    expect(d.added).toEqual([resolve(HOME, TARGET_REL)]);
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
