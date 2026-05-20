import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uninstallSkill } from "./uninstall-skill.js";

const TARGET_REL = ".claude/skills/magpie-master/SKILL.md";

let HOME = "";

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "magpie-uninstallskill-"));
});

afterEach(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("uninstallSkill (v0.9.2 Phase B/S6 — --uninstall-skill CLI)", () => {
  it("noop-missing: target absent → status noop-missing, exit 0, nothing changes", () => {
    const result = uninstallSkill({ home: HOME });
    expect(result.status).toBe("noop-missing");
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/not installed/);
  });

  it("removed: target present → unlinked, exit 0, empty magpie-master dir cleaned", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "skill content", "utf8");
    const result = uninstallSkill({ home: HOME });
    expect(result.status).toBe("removed");
    expect(result.exitCode).toBe(0);
    expect(existsSync(target)).toBe(false);
    // magpie-master dir was solely owned by us → removed
    expect(existsSync(dirname(target))).toBe(false);
    // parent .claude/skills/ remains (shared with other skills)
    expect(existsSync(resolve(HOME, ".claude/skills"))).toBe(true);
  });

  it("preserves sibling files in magpie-master/ if any (does not rmdir non-empty)", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "skill content", "utf8");
    const sibling = resolve(dirname(target), "notes.md");
    writeFileSync(sibling, "owner notes", "utf8");
    const result = uninstallSkill({ home: HOME });
    expect(result.status).toBe("removed");
    expect(existsSync(target)).toBe(false);
    // dir survives because sibling still occupies it
    expect(existsSync(dirname(target))).toBe(true);
    expect(existsSync(sibling)).toBe(true);
  });

  it("idempotent: second call after removal returns noop-missing", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "skill content", "utf8");
    expect(uninstallSkill({ home: HOME }).status).toBe("removed");
    expect(uninstallSkill({ home: HOME }).status).toBe("noop-missing");
  });

  it("leaves unrelated ~/.claude tree untouched", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "skill content", "utf8");
    const otherSkill = resolve(HOME, ".claude/skills/other-skill/SKILL.md");
    mkdirSync(dirname(otherSkill), { recursive: true });
    writeFileSync(otherSkill, "other content", "utf8");
    uninstallSkill({ home: HOME });
    expect(existsSync(otherSkill)).toBe(true);
    expect(readdirSync(resolve(HOME, ".claude/skills"))).toContain("other-skill");
  });
});
