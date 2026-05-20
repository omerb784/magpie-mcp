import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = __dirname;
const ROUTES_DIR = join(__dirname, "..", "http", "routes");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
}

// Forbidden shapes: any pattern that wraps a `better-sqlite3` call in async.
// `await <ident>.prepare(`, `await <ident>.exec(`, `await <ident>.transaction(`,
// `await <ident>.pragma(`, `await getDb(`, `Promise.resolve(<ident>.prepare`.
//
// Allowed: `await new Promise((resolve) => setTimeout(...))` — the
// `waitForRender` poll loop is an intentional sleep between SYNC sqlite reads.
// That pattern doesn't reference any db handle, so the regex bypasses it.
const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "await <id>.prepare(", re: /\bawait\s+\w+\.prepare\s*\(/ },
  { name: "await <id>.exec(", re: /\bawait\s+\w+\.exec\s*\(/ },
  { name: "await <id>.transaction(", re: /\bawait\s+\w+\.transaction\s*\(/ },
  { name: "await <id>.pragma(", re: /\bawait\s+\w+\.pragma\s*\(/ },
  { name: "await getDb()", re: /\bawait\s+getDb\s*\(/ },
  { name: "Promise.resolve(<id>.prepare(", re: /Promise\.resolve\s*\(\s*\w+\.prepare\s*\(/ },
];

describe("H1 · sqlite sync correctness", () => {
  it("no async wrapper around better-sqlite3 calls in src/store/*.ts", () => {
    const files = listSourceFiles(STORE_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offences: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        const match = body.match(re);
        if (match) {
          const line = body.slice(0, match.index ?? 0).split("\n").length;
          offences.push(`${file}:${line} matched "${name}"`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("no async wrapper around better-sqlite3 calls in src/http/routes/*.ts", () => {
    const files = listSourceFiles(ROUTES_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offences: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        const match = body.match(re);
        if (match) {
          const line = body.slice(0, match.index ?? 0).split("\n").length;
          offences.push(`${file}:${line} matched "${name}"`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});

describe("H1 · PRAGMA pins on freshly-opened DB (Phase D/D4 cross-reference)", () => {
  let scratchHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    closeDb();
    prevHome = process.env.MAGPIE_HOME;
    scratchHome = mkdtempSync(join(tmpdir(), "magpie-h1-pragma-"));
    process.env.MAGPIE_HOME = scratchHome;
  });

  afterEach(() => {
    closeDb();
    if (prevHome !== undefined) process.env.MAGPIE_HOME = prevHome;
    else delete process.env.MAGPIE_HOME;
    if (existsSync(scratchHome)) rmSync(scratchHome, { recursive: true, force: true });
  });

  it("journal_mode = wal", () => {
    const db = getDb();
    const row = db.pragma("journal_mode", { simple: true });
    expect(row).toBe("wal");
  });

  it("synchronous = 1 (NORMAL)", () => {
    const db = getDb();
    const row = db.pragma("synchronous", { simple: true });
    expect(row).toBe(1);
  });

  it("busy_timeout = 5000", () => {
    const db = getDb();
    const row = db.pragma("busy_timeout", { simple: true });
    expect(row).toBe(5000);
  });

  it("foreign_keys = 1", () => {
    const db = getDb();
    const row = db.pragma("foreign_keys", { simple: true });
    expect(row).toBe(1);
  });

});
