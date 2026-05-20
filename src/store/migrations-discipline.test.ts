import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, runMigrations } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(__dirname, "migrations");

let scratchHome: string;

function snapshotSchema(db: Database.Database) {
  return db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all();
}

function copyMigrations(targetDir: string, exclude: number[] = []) {
  mkdirSync(targetDir, { recursive: true });
  for (const file of readdirSync(REAL_MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const num = Number(file.split("_")[0]);
    if (exclude.includes(num)) continue;
    copyFileSync(join(REAL_MIGRATIONS_DIR, file), join(targetDir, file));
  }
}

beforeEach(() => {
  closeDb();
  scratchHome = mkdtempSync(join(tmpdir(), "magpie-mig-disc-"));
});

afterEach(() => {
  closeDb();
  if (existsSync(scratchHome)) rmSync(scratchHome, { recursive: true, force: true });
});

describe("D1 · migration discipline", () => {
  it("reboot is a no-op — schema fingerprint stable across two runMigrations passes", () => {
    process.env.MAGPIE_HOME = scratchHome;
    const db = getDb();
    const first = snapshotSchema(db);
    const versionAfterFirst = (
      db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as {
        value: string;
      }
    ).value;

    runMigrations(db);

    const second = snapshotSchema(db);
    const versionAfterSecond = (
      db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as {
        value: string;
      }
    ).value;

    expect(versionAfterSecond).toBe(versionAfterFirst);
    expect(second).toEqual(first);
  });

  it("throws on forward gap — missing migration N between 1 and max", () => {
    const fakeDir = join(scratchHome, "migs-with-gap");
    copyMigrations(fakeDir, [5]);

    const db = new Database(join(scratchHome, "test.db"));
    try {
      expect(() => runMigrations(db, fakeDir)).toThrow(
        /migration gap: version 5 missing between 1 and \d+/
      );
    } finally {
      db.close();
    }
  });

  it("throws on downgrade — schema_version higher than any known migration", () => {
    const dbPath = join(scratchHome, "test.db");
    const db1 = new Database(dbPath);
    try {
      runMigrations(db1);
      db1.exec("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '999')");
    } finally {
      db1.close();
    }

    const db2 = new Database(dbPath);
    try {
      expect(() => runMigrations(db2)).toThrow(/schema_version 999 exceeds known migrations/);
    } finally {
      db2.close();
    }
  });

  it("throws on empty migrations directory", () => {
    const emptyDir = join(scratchHome, "empty-migs");
    mkdirSync(emptyDir, { recursive: true });
    const db = new Database(join(scratchHome, "test.db"));
    try {
      expect(() => runMigrations(db, emptyDir)).toThrow(/no migrations found/);
    } finally {
      db.close();
    }
  });

  it("FK-OFF rebuild window · finding pin · 003 + 004 lack transactional wrapping", () => {
    // D1 audit finding (severity: minor, defer fix to v0.9.3):
    //   003 + 004 rebuild visuals via CREATE TABLE _new ... DROP TABLE old ... RENAME.
    //   The runner calls db.exec(sql) which executes statement-by-statement, NOT in
    //   a transaction. A crash between DROP and RENAME loses data. SQLite PRAGMA
    //   foreign_keys cannot be set inside a transaction, so adding BEGIN/COMMIT
    //   requires refactoring 003/004 to use defer_foreign_keys instead.
    //
    // This test pins the current shape so a future refactor surfaces here.
    for (const num of [3, 4]) {
      const file = readdirSync(REAL_MIGRATIONS_DIR).find((f) => f.startsWith(`00${num}_`));
      expect(file, `migration 00${num} expected`).toBeTruthy();
      const sql = readFileSync(join(REAL_MIGRATIONS_DIR, file!), "utf8");
      expect(sql).toMatch(/PRAGMA\s+foreign_keys\s*=\s*OFF/i);
      expect(sql).not.toMatch(/BEGIN\s+TRANSACTION/i);
      expect(sql).not.toMatch(/COMMIT/i);
    }
  });
});
