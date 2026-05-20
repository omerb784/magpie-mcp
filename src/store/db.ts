import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export type DB = Database.Database;

let cached: DB | null = null;

export function getDb(): DB {
  if (cached) return cached;
  ensureHomeDir();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // synchronous=NORMAL is durable on WAL (commits survive process crash + OS crash;
  // only an OS-level fsync failure loses the latest committed txn) and ~2x faster
  // under burst than the FULL default. busy_timeout=5000 lets a writer block up to
  // 5s on a busy DB instead of erroring immediately (rare given single-process model,
  // but cheap insurance for Path 2 multi-facade boot races).
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  cached = db;
  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}

function ensureHomeDir(): void {
  if (!existsSync(config.home)) mkdirSync(config.home, { recursive: true });
  if (!existsSync(config.blobsRoot)) mkdirSync(config.blobsRoot, { recursive: true });
}

export function runMigrations(db: DB, dir: string = MIGRATIONS_DIR): void {
  const current = readSchemaVersion(db);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const versions = files
    .map((f) => Number(f.split("_")[0]))
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (versions.length === 0) {
    throw new Error(`[magpie] no migrations found in ${dir}`);
  }
  const maxFile = Math.max(...versions);
  const fileSet = new Set(versions);
  for (let expected = 1; expected <= maxFile; expected++) {
    if (!fileSet.has(expected)) {
      throw new Error(
        `[magpie] migration gap: version ${expected} missing between 1 and ${maxFile}`
      );
    }
  }
  if (current > maxFile) {
    throw new Error(
      `[magpie] schema_version ${current} exceeds known migrations (max ${maxFile}). ` +
        `Likely an older binary opening a DB written by a newer Magpie. ` +
        `Upgrade to a build that ships migration ${current} or restore from backup.`
    );
  }
  for (const file of files) {
    const num = Number(file.split("_")[0]);
    if (Number.isNaN(num)) continue;
    if (num <= current) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    db.exec(sql);
  }
}

export function readSchemaVersion(db: DB): number {
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}
