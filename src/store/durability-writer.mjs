// v0.9.2 Phase D / D4 — durability harness child writer.
//
// Opens the DB at argv[2] with the same PRAGMAs production uses, then commits
// rows in a tight loop. The parent reads stdout (one line per commit) to know
// how many rows landed, then SIGKILLs us at a known offset. We never exit
// cleanly — the parent is responsible for termination.
//
// We use a dedicated `durability_probe` table so we don't interfere with the
// schema under test. The parent created it before spawning.

import Database from "better-sqlite3";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: durability-writer.mjs <dbPath>");
  process.exit(2);
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

const insert = db.prepare(
  "INSERT INTO durability_probe (n, payload, ts) VALUES (?, ?, ?)"
);

let n = 0;
const payload = "x".repeat(64);
// Tight loop. Each insert is its own implicit transaction → fsync per commit
// at synchronous=NORMAL. After each commit, emit the row count so the parent
// knows it's safe to SIGKILL.
for (;;) {
  n++;
  insert.run(n, payload, Date.now());
  process.stdout.write(`${n}\n`);
}
