import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, readSchemaVersion, runMigrations } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(__dirname, "migrations");

function copyMigrationsUpTo(targetDir: string, maxVersion: number): void {
  mkdirSync(targetDir, { recursive: true });
  for (const file of readdirSync(REAL_MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const num = Number(file.split("_")[0]);
    if (Number.isNaN(num)) continue;
    if (num <= maxVersion) {
      copyFileSync(join(REAL_MIGRATIONS_DIR, file), join(targetDir, file));
    }
  }
}

function tablesIn(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function columnsOf(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function indexesOf(db: Database.Database, table: string): Set<string> {
  const rows = db
    .prepare(`PRAGMA index_list(${table})`)
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

let scratchHome: string;

beforeEach(() => {
  closeDb();
  scratchHome = mkdtempSync(join(tmpdir(), "magpie-h2-replay-"));
});

afterEach(() => {
  closeDb();
  if (existsSync(scratchHome)) rmSync(scratchHome, { recursive: true, force: true });
});

const MAX_SCHEMA_VERSION = 15;

describe("H2 · migration ordering — replay scenarios", () => {
  it("(a) fresh home — empty DB lands at MAX_SCHEMA_VERSION", () => {
    const dbPath = join(scratchHome, "fresh.db");
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      expect(readSchemaVersion(db)).toBe(MAX_SCHEMA_VERSION);
      // Every core table created by the migration chain exists.
      const tables = tablesIn(db);
      for (const expected of [
        "projects",
        "visuals",
        "versions",
        "tags",
        "visual_tags",
        "send_templates",
        "send_template_versions",
        "agent_inbox",
        "meta",
      ]) {
        expect(tables.has(expected), `table ${expected} missing`).toBe(true);
      }
      // versions.description column from 013
      expect(columnsOf(db, "versions").has("description")).toBe(true);
      // find_visuals indexes from 014
      const visualIdx = indexesOf(db, "visuals");
      expect(visualIdx.has("idx_visuals_type")).toBe(true);
      expect(visualIdx.has("idx_visuals_updated_at")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("(b) v0.9.2-A seed (schema_version=12) replays 13 + 14 cleanly", () => {
    // Build a partial migrations dir that only contains 001-012, run it
    // against a fresh DB. That gives us a DB that looks like a Magpie home
    // frozen just before Phase A landed migration 013. Then re-run with the
    // FULL real migrations dir and expect 13 + 14 to apply.
    const partialDir = join(scratchHome, "partial-12");
    copyMigrationsUpTo(partialDir, 12);

    const dbPath = join(scratchHome, "seed12.db");
    const db1 = new Database(dbPath);
    try {
      runMigrations(db1, partialDir);
      expect(readSchemaVersion(db1)).toBe(12);
      // versions.description should NOT exist yet.
      expect(columnsOf(db1, "versions").has("description")).toBe(false);
      // idx_visuals_type should NOT exist yet.
      expect(indexesOf(db1, "visuals").has("idx_visuals_type")).toBe(false);
    } finally {
      db1.close();
    }

    // Re-open with full migrations dir → expect 13 + 14 to apply.
    const db2 = new Database(dbPath);
    try {
      runMigrations(db2);
      expect(readSchemaVersion(db2)).toBe(MAX_SCHEMA_VERSION);
      expect(columnsOf(db2, "versions").has("description")).toBe(true);
      expect(indexesOf(db2, "visuals").has("idx_visuals_type")).toBe(true);
      expect(indexesOf(db2, "visuals").has("idx_visuals_updated_at")).toBe(true);
    } finally {
      db2.close();
    }
  });

  it("(c) v0.9.2-pre-D3 seed (schema_version=13) replays only 14 cleanly", () => {
    const partialDir = join(scratchHome, "partial-13");
    copyMigrationsUpTo(partialDir, 13);

    const dbPath = join(scratchHome, "seed13.db");
    const db1 = new Database(dbPath);
    try {
      runMigrations(db1, partialDir);
      expect(readSchemaVersion(db1)).toBe(13);
      expect(columnsOf(db1, "versions").has("description")).toBe(true);
      expect(indexesOf(db1, "visuals").has("idx_visuals_type")).toBe(false);
    } finally {
      db1.close();
    }

    const db2 = new Database(dbPath);
    try {
      runMigrations(db2);
      expect(readSchemaVersion(db2)).toBe(MAX_SCHEMA_VERSION);
      expect(indexesOf(db2, "visuals").has("idx_visuals_type")).toBe(true);
      expect(indexesOf(db2, "visuals").has("idx_visuals_updated_at")).toBe(true);
    } finally {
      db2.close();
    }
  });

  it("concurrent-boot race · two handles on the same DB serialise without double-apply", () => {
    // Path-2 lifecycle (R19) makes this scenario impossible in production —
    // only the canonical writer holds the lock. H2 documents the invariant
    // from the SQLite-layer side anyway: even if two handles on the same DB
    // call runMigrations() back-to-back, busy_timeout=5000 lets them
    // serialise instead of erroring, and the runner skips already-applied
    // migrations (num <= current).
    const dbPath = join(scratchHome, "race.db");
    const db1 = new Database(dbPath);
    const db2 = new Database(dbPath);
    try {
      // Set the same PRAGMAs db.ts sets so the test reflects production.
      for (const db of [db1, db2]) {
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.pragma("synchronous = NORMAL");
        db.pragma("busy_timeout = 5000");
      }
      // First handle runs the full migration chain.
      runMigrations(db1);
      expect(readSchemaVersion(db1)).toBe(MAX_SCHEMA_VERSION);
      // Second handle calls runMigrations on the same DB. Expectation:
      // no throw, schema_version stays at MAX_SCHEMA_VERSION, no migration
      // re-runs (idempotent no-op because every num <= current).
      runMigrations(db2);
      expect(readSchemaVersion(db2)).toBe(MAX_SCHEMA_VERSION);

      // Row-count invariant: every table from db1 still has the same row
      // count from db2's view. The meta table is the cheapest pin — only
      // one schema_version row should exist.
      const metaRows = db2
        .prepare("SELECT COUNT(*) AS c FROM meta WHERE key='schema_version'")
        .get() as { c: number };
      expect(metaRows.c).toBe(1);
    } finally {
      db1.close();
      db2.close();
    }
  });

  it("seed-version > max throws downgrade-refusal (D1 cross-reference)", () => {
    // H2 cross-references the D1 downgrade-refusal pin from
    // migrations-discipline.test.ts. Re-asserts here so the H2 audit doc
    // can claim coverage without referring to a different test file.
    const dbPath = join(scratchHome, "downgrade.db");
    const db1 = new Database(dbPath);
    try {
      runMigrations(db1);
      // Force schema_version higher than any known migration.
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
});
