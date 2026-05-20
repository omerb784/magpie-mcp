// v0.9.3 Phase G · G6 — install-skill 5-branch CLI flow.
//
// Spawns `node tsx src/index.ts --install-skill` against tmp HOME pointing
// at a synthetic `.claude/` tree. Walks all 5 status outcomes plus
// noop-same and unknown-host fall-throughs (7 total).
//
// Uses HOME/USERPROFILE env override — os.homedir() honors both per
// platform.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""),
  "..",
  "..",
);
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const BUNDLED_SKILL = path.join(REPO_ROOT, "skill", "magpie-master", "SKILL.md");
const BUNDLED_CONTENT = readFileSync(BUNDLED_SKILL, "utf8");
const BUNDLED_VERSION = parseVersion(BUNDLED_CONTENT) ?? "0.0.0";

function parseVersion(content: string): string | null {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const body = fm?.[1];
  if (!body) return null;
  const m = body.match(/^version:\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function withBumpedVersion(content: string, newVersion: string): string {
  return content.replace(/^version:\s*.+$/m, `version: ${newVersion}`);
}

type RunResult = { stdout: string; stderr: string; status: number };

function runInstall(home: string, args: string[] = []): RunResult {
  const r = spawnSync(
    process.execPath,
    [TSX_BIN, INDEX_TS, "--install-skill", ...args],
    {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status ?? -1,
  };
}

function skillTarget(home: string): string {
  return path.join(home, ".claude", "skills", "magpie-master", "SKILL.md");
}

let HOME = "";

beforeEach(() => {
  HOME = path.join(tmpdir(), `magpie-g6-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("G6 · install-skill 5-branch CLI", () => {
  it("unknown-host · no .claude/ → exit 0 with manual-copy instructions", () => {
    const r = runInstall(HOME);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Claude Code not detected");
    expect(r.stdout).toContain(skillTarget(HOME));
    expect(existsSync(skillTarget(HOME))).toBe(false);
  }, 30_000);

  it("fresh-install · .claude/ exists, no skill → status copied", () => {
    mkdirSync(path.join(HOME, ".claude"), { recursive: true });
    const r = runInstall(HOME);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Installed magpie-master skill at/);
    expect(readFileSync(skillTarget(HOME), "utf8")).toBe(BUNDLED_CONTENT);
  }, 30_000);

  it("noop-same · identical content → status noop-same", () => {
    const target = skillTarget(HOME);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, BUNDLED_CONTENT, "utf8");
    const r = runInstall(HOME);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already up to date/);
  }, 30_000);

  it("upgrade · older installed → status upgraded", () => {
    const target = skillTarget(HOME);
    mkdirSync(path.dirname(target), { recursive: true });
    const older = withBumpedVersion(BUNDLED_CONTENT, "0.0.1");
    writeFileSync(target, older, "utf8");
    const r = runInstall(HOME);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`Upgraded magpie-master skill 0\\.0\\.1 → ${BUNDLED_VERSION.replace(/\./g, "\\.")}`));
    expect(readFileSync(target, "utf8")).toBe(BUNDLED_CONTENT);
  }, 30_000);

  it("downgrade-warn · newer installed → refused without --force, exit 0", () => {
    const target = skillTarget(HOME);
    mkdirSync(path.dirname(target), { recursive: true });
    const newer = withBumpedVersion(BUNDLED_CONTENT, "99.0.0");
    writeFileSync(target, newer, "utf8");
    const r = runInstall(HOME);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/newer than the bundled copy/);
    expect(readFileSync(target, "utf8")).toBe(newer);
  }, 30_000);

  it("refused-edited · same version, edited body → exit 1 without --force", () => {
    const target = skillTarget(HOME);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, BUNDLED_CONTENT + "\n\n<!-- hand-edited -->\n", "utf8");
    const r = runInstall(HOME);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing to overwrite without --force/);
    expect(readFileSync(target, "utf8")).toContain("hand-edited");
  }, 30_000);

  it("--force overrides refused-edited → status copied", () => {
    const target = skillTarget(HOME);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, BUNDLED_CONTENT + "\n\n<!-- hand-edited -->\n", "utf8");
    const r = runInstall(HOME, ["--force"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Forced overwrite/);
    expect(readFileSync(target, "utf8")).toBe(BUNDLED_CONTENT);
  }, 30_000);
});
