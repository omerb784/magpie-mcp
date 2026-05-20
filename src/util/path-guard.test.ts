import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { readContentPath } from "./path-guard.js";

const ROOT = resolve(config.contentRoot);
const SCRATCH = join(ROOT, ".tmp-pathguard");

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("readContentPath", () => {
  it("reads a regular file inside the content root", () => {
    const p = join(SCRATCH, "hello.md");
    writeFileSync(p, "# Hello", "utf8");
    const r = readContentPath(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("# Hello");
      expect(r.resolved_path).toBe(p);
    }
  });

  it("rejects relative paths", () => {
    const r = readContentPath("./foo.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("relative");
  });

  it("rejects nonexistent paths", () => {
    const r = readContentPath(join(SCRATCH, "nope.md"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });

  it("rejects paths outside the content root", () => {
    // Use a known outside-root absolute path. /etc on Unix or C:\Windows on Windows.
    const outside = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/hosts";
    const r = readContentPath(outside);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // either outside_root (existed and resolved) or not_found (file missing) — both prove the gate held
      expect(["outside_root", "not_found"]).toContain(r.code);
    }
  });

  it("rejects a symlink that points outside the content root", () => {
    if (process.platform === "win32") return; // symlink creation requires elevated privs on Windows
    const linkPath = join(SCRATCH, "escape");
    const target = process.platform === "darwin" ? "/etc/hosts" : "/etc/hostname";
    try {
      symlinkSync(target, linkPath);
    } catch {
      return; // symlink not permitted in this test env — skip silently
    }
    const r = readContentPath(linkPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("outside_root");
  });

  it("rejects directories", () => {
    const r = readContentPath(SCRATCH);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_file");
  });

  it("rejects files larger than maxContentBytes", () => {
    const p = join(SCRATCH, "fat.html");
    const size = config.maxContentBytes + 1;
    writeFileSync(p, "x".repeat(size), "utf8");
    const r = readContentPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_big");
  });
});
