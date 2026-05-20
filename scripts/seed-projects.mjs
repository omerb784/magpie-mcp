#!/usr/bin/env node
// v0.9.2 Phase J / J5 — 50-project sidebar fixture.
//
// Seeds $MAGPIE_HOME with N empty projects (default 50) named `j5-NN-<slug>`.
// No visuals — sidebar surface only. Idempotent via meta-key marker; --reset
// scopes cleanup to the j5- prefix so Owner projects are untouched.
//
// Used by:
//   - Phase J / J5 — sidebar paint + scroll-jank @ 50 projects
//
// Tarball allowlist (Phase B/S1) excludes scripts/ — Owner never sees this.
//
// Usage:
//   MAGPIE_HOME=/path node scripts/seed-projects.mjs              # seed 50
//   MAGPIE_HOME=/path node scripts/seed-projects.mjs --reset      # wipe + re-seed 50
//   MAGPIE_HOME=/path node scripts/seed-projects.mjs --wipe-only  # wipe only (no re-seed)
//   MAGPIE_HOME=/path node scripts/seed-projects.mjs --count=20 --json

import Database from "better-sqlite3";
import { customAlphabet } from "nanoid";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "src", "store", "migrations");

const SEED_MARKER_KEY = "seed_projects_j5_marker";
const SEED_PREFIX = "j5-";
const PROJECT_TYPES = ["mockup", "diagram", "mixed"];

const SLUGS = [
  "auth", "billing", "dashboard", "settings", "onboarding", "checkout",
  "pricing", "hero", "footer", "nav", "modal", "table", "form", "chart",
  "pipeline", "metrics", "tracing", "alerts", "users", "roles",
  "perms", "audit", "sso", "saml", "webhooks", "api", "schema", "indexes",
  "queue", "worker", "scheduler", "cache", "session", "tokens", "keys",
  "search", "tagging", "favorites", "archive", "trash", "export",
  "import", "diff", "merge", "history", "snapshots", "branches", "tags",
  "compare", "preview",
];

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const newId = customAlphabet(ID_ALPHABET, 12);
const nowIso = () => new Date().toISOString();

function resolveHome() {
  return process.env.MAGPIE_HOME ?? join(homedir(), ".magpie");
}

function ensureDirs(home) {
  if (!existsSync(home)) mkdirSync(home, { recursive: true });
  const blobs = join(home, "blobs");
  if (!existsSync(blobs)) mkdirSync(blobs, { recursive: true });
}

function runMigrations(db) {
  const current = (() => {
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
      return row ? Number(row.value) : 0;
    } catch {
      return 0;
    }
  })();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const num = Number(file.split("_")[0]);
    if (Number.isNaN(num) || num <= current) continue;
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

// Deterministic RNG so seeded data is reproducible. Distinct seed from
// seed-bench.mjs so tag-pool / title shapes don't collide.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(99);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function parseCount(argv) {
  for (const a of argv) {
    if (a.startsWith("--count=")) {
      const v = Number(a.slice("--count=".length));
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
        throw new Error(`[seed-projects] --count must be a positive integer, got ${a}`);
      }
      if (v > 1000) {
        throw new Error(`[seed-projects] --count must be <= 1000 (got ${v})`);
      }
      return v;
    }
  }
  return 50;
}

function readMarker(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SEED_MARKER_KEY);
  return row ? row.value : null;
}

function reset(db) {
  const tx = db.transaction(() => {
    const removed = db.prepare("DELETE FROM projects WHERE name LIKE ?").run(`${SEED_PREFIX}%`);
    db.prepare("DELETE FROM meta WHERE key = ?").run(SEED_MARKER_KEY);
    return removed.changes ?? 0;
  });
  return tx();
}

function seed(db, count) {
  const insertProject = db.prepare(
    "INSERT INTO projects (id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const startedAt = Date.now();
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = newId();
      const slug = SLUGS[i % SLUGS.length];
      const name = `${SEED_PREFIX}${String(i).padStart(2, "0")}-${slug}`;
      const now = nowIso();
      insertProject.run(id, name, pick(PROJECT_TYPES), null, now, now);
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      SEED_MARKER_KEY,
      nowIso()
    );
  });
  tx();
  return {
    projectsInserted: count,
    elapsedMs: Date.now() - startedAt,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const wantReset = args.has("--reset");
  const wantWipeOnly = args.has("--wipe-only");
  const wantJson = args.has("--json");
  const count = parseCount(argv);

  const home = resolveHome();
  ensureDirs(home);
  const dbPath = join(home, "db.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  let resetCount = 0;
  if (wantReset || wantWipeOnly) {
    resetCount = reset(db);
  }

  if (wantWipeOnly) {
    db.close();
    const summary = { status: "wiped", home, resetCount };
    if (wantJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`[seed-projects] wiped     ${resetCount} rows · home ${home}`);
    }
    return;
  }

  const existing = readMarker(db);
  if (existing && !wantReset) {
    const summary = {
      status: "skipped",
      reason: "seed marker already present; pass --reset to re-seed",
      marker: existing,
      home,
    };
    db.close();
    if (wantJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`[seed-projects] already seeded at ${existing} — pass --reset to re-seed`);
    }
    return;
  }

  const result = seed(db, count);
  db.close();

  const summary = {
    status: "ok",
    home,
    resetCount,
    targetCount: count,
    ...result,
  };

  if (wantJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`[seed-projects] home       ${home}`);
  console.log(`[seed-projects] target     ${count} projects`);
  if (wantReset) {
    console.log(`[seed-projects] reset      ${resetCount} rows`);
  }
  console.log(`[seed-projects] inserted   ${result.projectsInserted}`);
  console.log(`[seed-projects] elapsed    ${result.elapsedMs} ms`);
}

main();
