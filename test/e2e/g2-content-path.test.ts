// v0.9.3 Phase G · G2 — content_path + path-guard.
//
// Large file under cwd resolves · above-cwd rejected with outside_root ·
// symlink escape rejected · source edits AFTER call don't mutate stored v1.

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootPair,
  makeHome,
  mcpCall,
  mcpInit,
  parseVisualId,
  shutdownPair,
  type Pair,
} from "./_helpers.js";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""),
  "..",
  "..",
);
const FIXTURE_DIR = path.join(REPO_ROOT, ".tmp-e2e-g2-fixture");

let pair: Pair | undefined;

beforeAll(async () => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  pair = await bootPair(makeHome("g2"));
  await mcpInit(pair);
}, 120_000);

afterAll(async () => {
  await shutdownPair(pair);
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("G2 · content_path path-guard", () => {
  it(
    "100KB file under cwd-subtree resolves · stored bytes immutable after caller edits",
    async () => {
      if (!pair) throw new Error("setup failed");

      const fixturePath = path.join(FIXTURE_DIR, "big.html");
      const body = "<!doctype html><body>" + "x".repeat(110_000) + "</body>";
      writeFileSync(fixturePath, body, "utf8");

      const add = await mcpCall(pair, "add_visual", {
        project: "g2-content-path",
        type: "html",
        title: "G2 big",
        content_path: fixturePath,
      });
      expect(add.isError).toBe(false);
      const visualId = parseVisualId(add.text);

      writeFileSync(fixturePath, "<body>MUTATED AFTER CALL</body>", "utf8");

      const blobPath = path.join(pair.home, "blobs", visualId, "v1.html");
      const stored = readFileSync(blobPath, "utf8");
      expect(stored).toContain("x".repeat(100));
      expect(stored).not.toContain("MUTATED AFTER CALL");
    },
    60_000,
  );

  it(
    "above-cwd absolute path rejected with outside_root",
    async () => {
      if (!pair) throw new Error("setup failed");

      const outside = path.join(tmpdir(), `magpie-g2-escape-${process.pid}.html`);
      writeFileSync(outside, "<body>outside</body>", "utf8");

      try {
        const r = await mcpCall(pair, "add_visual", {
          project: "g2-escape",
          type: "html",
          title: "G2 outside",
          content_path: outside,
        });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/content_path rejected \(outside_root\)/);
      } finally {
        try {
          rmSync(outside, { force: true });
        } catch {
          /* ignore */
        }
      }
    },
    30_000,
  );

  it(
    "symlink under cwd pointing outside resolves to outside_root rejection",
    async () => {
      if (!pair) throw new Error("setup failed");
      if (process.platform === "win32") {
        // Windows symlink requires admin or Developer Mode — skip rather than
        // fail spuriously on Owner's box.
        return;
      }

      const targetOutside = path.join(tmpdir(), `magpie-g2-symtarget-${process.pid}.html`);
      writeFileSync(targetOutside, "<body>sym target</body>", "utf8");
      const linkUnderCwd = path.join(FIXTURE_DIR, "sym-escape.html");
      try {
        symlinkSync(targetOutside, linkUnderCwd);
      } catch {
        return; // symlink not permitted — skip silently
      }

      try {
        const r = await mcpCall(pair, "add_visual", {
          project: "g2-symlink",
          type: "html",
          title: "G2 symlink",
          content_path: linkUnderCwd,
        });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/content_path rejected \(outside_root\)/);
      } finally {
        try {
          rmSync(linkUnderCwd, { force: true });
        } catch {
          /* ignore */
        }
        try {
          rmSync(targetOutside, { force: true });
        } catch {
          /* ignore */
        }
      }
    },
    30_000,
  );

  it(
    "relative path rejected",
    async () => {
      if (!pair) throw new Error("setup failed");
      const r = await mcpCall(pair, "add_visual", {
        project: "g2-relative",
        type: "html",
        title: "G2 relative",
        content_path: "./does-not-exist.html",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/content_path rejected \(relative\)/);
    },
    20_000,
  );
});
