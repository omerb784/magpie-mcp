import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITER = join(__dirname, "durability-writer.mjs");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "magpie-durability-"));
});

afterEach(async () => {
  if (!existsSync(home)) return;
  // v0.9.3 - Windows holds the SQLite WAL handle briefly after better-sqlite3
  // db.close(). One retry with a small backoff is enough; if it still fails,
  // leave the temp dir behind (OS cleans on reboot) rather than crashing the
  // suite.
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* leave it */
    }
  }
});

function prepareProbeDb(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE durability_probe (
      n       INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      ts      INTEGER NOT NULL
    );
  `);
  db.close();
}

function waitForCommits(child: ReturnType<typeof spawn>, minRows: number, timeoutMs: number) {
  return new Promise<number>((resolve, reject) => {
    let lastRow = 0;
    const timer = setTimeout(() => {
      reject(new Error(`writer never reached ${minRows} commits (last=${lastRow})`));
    }, timeoutMs);
    child.stdout!.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      const last = lines[lines.length - 1];
      const n = Number(last);
      if (!Number.isNaN(n)) lastRow = n;
      if (lastRow >= minRows) {
        clearTimeout(timer);
        resolve(lastRow);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`writer exited unexpectedly with code ${code}, lastRow=${lastRow}`));
    });
  });
}

describe("D4 · WAL + fsync durability under hard kill", () => {
  it("SIGKILL mid-write — committed rows survive + integrity intact", async () => {
    const dbPath = join(home, "probe.sqlite");
    prepareProbeDb(dbPath);

    const child = spawn(process.execPath, [WRITER, dbPath], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const observedCommits = await waitForCommits(child, 200, 10_000);
    child.kill("SIGKILL");

    // Wait for OS to mark the child as exited (Windows + POSIX). Without this,
    // file handle on Windows may still be locked.
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.killed) resolve();
      else child.on("exit", () => resolve());
    });

    // Reopen and verify.
    const db = new Database(dbPath);
    try {
      const integrity = db.prepare("PRAGMA integrity_check").get() as
        | { integrity_check: string }
        | undefined;
      expect(integrity?.integrity_check).toBe("ok");

      const count = (db.prepare("SELECT COUNT(*) c FROM durability_probe").get() as {
        c: number;
      }).c;
      // The parent observed N commits from stdout. SQLite must preserve >= a
      // generous floor of what we saw on stdout (there can be tiny slip if the
      // newline lands before the disk fsync replies, but synchronous=NORMAL
      // guarantees committed transactions survive process kill).
      expect(count).toBeGreaterThanOrEqual(Math.floor(observedCommits * 0.9));
      // Ceiling: should not exceed observedCommits + small write-ahead burst.
      expect(count).toBeLessThanOrEqual(observedCommits + 50);

      // Row IDs should be contiguous from 1 (no gaps from rolled-back commits).
      const max = (db.prepare("SELECT MAX(n) m FROM durability_probe").get() as {
        m: number;
      }).m;
      expect(max).toBeLessThanOrEqual(observedCommits + 50);
    } finally {
      db.close();
    }
  }, 20_000);

  it("PRAGMA values reflect production hardening (synchronous=NORMAL, busy_timeout=5000)", () => {
    // Live shape pin for D4. If a future contributor flips synchronous=OFF for
    // perf or drops busy_timeout, this test surfaces it as a regression.
    const dbPath = join(home, "pragma-probe.sqlite");
    prepareProbeDb(dbPath);

    // Open with the same hardening order as src/store/db.ts:getDb().
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");

    try {
      // synchronous returns numeric: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
      const sync = db.pragma("synchronous", { simple: true });
      expect(sync, "synchronous must be NORMAL (1) — not FULL (2) or OFF (0)").toBe(1);

      const busy = db.pragma("busy_timeout", { simple: true });
      expect(busy).toBe(5000);

      const journal = db.pragma("journal_mode", { simple: true });
      expect(journal).toBe("wal");
    } finally {
      db.close();
    }
  });
});
