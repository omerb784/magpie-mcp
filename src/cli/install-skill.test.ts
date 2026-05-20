import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill } from "./install-skill.js";

let HOME = "";
let BUNDLED = "";
let BUNDLED_PATH = "";

const TARGET_REL = ".claude/skills/magpie-master/SKILL.md";

function freshBundled(version: string, body = "body"): string {
  return `---\nname: magpie-master\ndescription: test trigger magpie magpie-mcp add_visual iterate nest\nversion: ${version}\n---\n\n# Master skill\n\n${body}\n`;
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "magpie-installskill-"));
  // Stage a bundled SKILL.md fixture
  const bundledDir = mkdtempSync(resolve(tmpdir(), "magpie-bundled-"));
  BUNDLED = bundledDir;
  BUNDLED_PATH = resolve(bundledDir, "SKILL.md");
  writeFileSync(BUNDLED_PATH, freshBundled("0.9.1", "bundled-body"), "utf8");
});

afterEach(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  if (BUNDLED && existsSync(BUNDLED)) rmSync(BUNDLED, { recursive: true, force: true });
});

describe("installSkill (v0.9.1 Phase C — --install-skill CLI)", () => {
  it("unknown-host: ~/.claude/ missing → prints manual-install instructions, exit 0", () => {
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("unknown-host");
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/Claude Code not detected/);
    // Did NOT create the target
    expect(existsSync(resolve(HOME, TARGET_REL))).toBe(false);
  });

  it("copied: ~/.claude/ exists, target missing → copy bundled, exit 0", () => {
    mkdirSync(resolve(HOME, ".claude"), { recursive: true });
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("copied");
    expect(result.exitCode).toBe(0);
    const target = resolve(HOME, TARGET_REL);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(readFileSync(BUNDLED_PATH, "utf8"));
  });

  it("noop-same: target identical to bundled → no-op, exit 0", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("0.9.1", "bundled-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("noop-same");
    expect(result.exitCode).toBe(0);
  });

  it("refused-edited: same version, different content, no --force → refuse with diff hint, exit 1", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("0.9.1", "owner-edited-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("refused-edited");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/--force/);
    expect(result.message).toMatch(/diff/);
    // Did NOT overwrite the owner's edit
    expect(readFileSync(target, "utf8")).toContain("owner-edited-body");
  });

  it("force overwrite: same version, different content, --force → copied, exit 0", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("0.9.1", "owner-edited-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH, force: true });
    expect(result.status).toBe("copied");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("bundled-body");
  });

  it("upgraded: installed version < bundled version → replace cleanly, exit 0 (no --force needed)", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("0.9.0", "older-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("upgraded");
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/0\.9\.0/);
    expect(result.message).toMatch(/0\.9\.1/);
    expect(readFileSync(target, "utf8")).toContain("bundled-body");
  });

  it("error: bundled SKILL.md missing → exit 1", () => {
    const result = installSkill({ home: HOME, bundledPath: resolve(BUNDLED, "nope.md") });
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(1);
  });

  // v0.9.2 Phase E/E4 - downgrade-warn outcome (installed version > bundled).
  it("downgrade-warn: installed version > bundled version, no --force → skip overwrite, exit 0", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("99.0.0", "future-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
    expect(result.status).toBe("downgrade-warn");
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/newer than the bundled copy/);
    expect(result.message).toMatch(/99\.0\.0/);
    expect(result.message).toMatch(/0\.9\.1/);
    expect(result.message).toMatch(/--force/);
    expect(readFileSync(target, "utf8")).toContain("future-body");
  });

  it("downgrade-warn + force → overwrites and reports copied, exit 0", () => {
    const target = resolve(HOME, TARGET_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, freshBundled("99.0.0", "future-body"), "utf8");
    const result = installSkill({ home: HOME, bundledPath: BUNDLED_PATH, force: true });
    expect(result.status).toBe("copied");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("bundled-body");
  });

  // v0.9.2 Phase E/E4 - pin observed stdout shapes per outcome so Owner-machine
  // smoke surfaces drift vs v0.9.1 close (each outcome message used in audit-04
  // walkthrough).
  describe("E4 outcome stdout shape pins", () => {
    it("copied (install) message names target path + 'Installed'", () => {
      mkdirSync(resolve(HOME, ".claude"), { recursive: true });
      const r = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
      expect(r.message).toMatch(/^Installed magpie-master skill at /);
      expect(r.message).toMatch(/SKILL\.md\.$/);
    });

    it("noop-same message names target path + 'already up to date'", () => {
      const target = resolve(HOME, TARGET_REL);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, freshBundled("0.9.1", "bundled-body"), "utf8");
      const r = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
      expect(r.message).toMatch(/already up to date at /);
    });

    it("upgraded message names installed -> bundled versions explicitly", () => {
      const target = resolve(HOME, TARGET_REL);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, freshBundled("0.9.0", "older-body"), "utf8");
      const r = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
      expect(r.message).toMatch(/Upgraded magpie-master skill 0\.9\.0/);
      expect(r.message).toMatch(/0\.9\.1/);
    });

    it("downgrade-warn message names both versions + suggests --force", () => {
      const target = resolve(HOME, TARGET_REL);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, freshBundled("99.0.0", "future-body"), "utf8");
      const r = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
      expect(r.message).toMatch(/Installed version: 99\.0\.0/);
      expect(r.message).toMatch(/Bundled version: 0\.9\.1/);
      expect(r.message).toMatch(/npx magpie-mcp --install-skill --force/);
    });

    it("unknown-host message includes Claude Code not detected + bundled path", () => {
      const r = installSkill({ home: HOME, bundledPath: BUNDLED_PATH });
      expect(r.message).toMatch(/Claude Code not detected at /);
      expect(r.message).toMatch(/manual/);
      expect(r.message).toContain(BUNDLED_PATH);
    });
  });
});
