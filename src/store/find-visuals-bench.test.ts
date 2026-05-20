import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db.js";
import { buildSearchVisualsSql, searchVisuals } from "./visuals.js";
import type { SearchVisualsArgs } from "./visuals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SEED_SCRIPT = join(REPO_ROOT, "scripts", "seed-bench.mjs");

// Per-shape p99 ceiling. SQLite + better-sqlite3 on dev laptops handles 1K
// indexed lookups in single-digit ms; 50 ms gives 5-10x headroom for CI noise.
const P99_BUDGET_MS = 50;

// Reuse vitest.setup's MAGPIE_HOME — seeding via spawnSync into the same dir
// is intentional. afterAll restores by closeDb + leaving the home wiped so the
// next test file sees a clean slate.
const HOME = process.env.MAGPIE_HOME!;

// Per-shape expectation:
//   "search-v"  -> driving SEARCH on v expected (good)
//   "scan-v-ok" -> SCAN v acceptable (documented finding; no index can help)
type DriverExpect = "search-v" | "scan-v-ok";

const SHAPES: Array<{ name: string; args: SearchVisualsArgs; driver: DriverExpect }> = [
  // Leading-% LIKE — unfixable without FTS5. Documented finding.
  { name: "title-LIKE", args: { query: "hero" }, driver: "scan-v-ok" },
  {
    name: "title-LIKE+description",
    args: { query: "hero", match_description: true },
    driver: "scan-v-ok",
  },
  // Correlated EXISTS forces driver = v. Query-rewrite breaks tags-AND. Documented finding.
  { name: "tag-single", args: { tags: ["seed-bench-tag-hero"] }, driver: "scan-v-ok" },
  {
    name: "tag-AND-three",
    args: { tags: ["seed-bench-tag-hero", "seed-bench-tag-final", "seed-bench-tag-wip"] },
    driver: "scan-v-ok",
  },
  // Index-driven shapes — must SEARCH v after migration 014.
  { name: "project-only", args: { project: "seed-bench-00-auth" }, driver: "search-v" },
  { name: "starred", args: { starred: true }, driver: "search-v" },
  { name: "type", args: { type: "html" }, driver: "search-v" },
  {
    name: "combined-project+starred+tag",
    args: {
      project: "seed-bench-00-auth",
      starred: true,
      tags: ["seed-bench-tag-hero"],
    },
    driver: "search-v",
  },
];

beforeAll(() => {
  closeDb();
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  const result = spawnSync(process.execPath, [SEED_SCRIPT, "--json"], {
    env: { ...process.env, MAGPIE_HOME: HOME },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`seed-bench failed: ${result.stderr}`);
  }
}, 30_000);

afterAll(() => {
  closeDb();
});

describe("D3 · find_visuals index coverage @ 1K visuals", () => {
  it("seeded DB has expected volume", () => {
    const db = getDb();
    expect((db.prepare("SELECT COUNT(*) c FROM visuals").get() as { c: number }).c).toBe(1000);
    expect((db.prepare("SELECT COUNT(*) c FROM projects").get() as { c: number }).c).toBe(20);
  });

  for (const shape of SHAPES) {
    it(`${shape.name} · driver is ${shape.driver}`, () => {
      const { sql, params } = buildSearchVisualsSql(shape.args);
      const plan = getDb()
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params) as Array<{ id: number; parent: number; detail: string }>;
      const planLines = plan.map((row) => row.detail);
      const planJoined = planLines.join(" | ");

      // Find the line touching `visuals v` as a driver (not the cv LEFT JOIN line).
      const vDriverLine = planLines.find(
        (l) => /\bSEARCH v\b|\bSCAN v\b/.test(l) && !/\bcv\b/.test(l)
      );
      expect(vDriverLine, `no v-driver line in plan: ${planJoined}`).toBeTruthy();

      if (shape.driver === "search-v") {
        expect(vDriverLine, `plan for ${shape.name}: ${planJoined}`).toMatch(
          /SEARCH v USING (COVERING )?INDEX/
        );
      } else {
        // scan-v-ok — finding documented in audit-03-db.md
        expect(vDriverLine).toMatch(/^SCAN v\b/);
      }

      // cv LEFT JOIN must always use the composite UNIQUE index (visual_id, version_num).
      const cvLine = planLines.find((l) => /\bcv\b/.test(l));
      if (cvLine) {
        expect(cvLine, `cv plan for ${shape.name}: ${cvLine}`).toMatch(/USING (COVERING )?INDEX/);
      }
    });
  }

  it(`p99 wall time ≤ ${P99_BUDGET_MS} ms across all shapes (50 runs each)`, () => {
    const RUNS = 50;
    const perShape: Record<string, number[]> = {};
    for (const shape of SHAPES) {
      const timings: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        searchVisuals(shape.args);
        timings.push(performance.now() - t0);
      }
      perShape[shape.name] = timings;
    }

    const worst: { shape: string; p99: number } = { shape: "", p99: 0 };
    for (const [name, ts] of Object.entries(perShape)) {
      const sorted = [...ts].sort((a, b) => a - b);
      const p99 = sorted[Math.floor(sorted.length * 0.99) - 1] ?? sorted[sorted.length - 1];
      if (p99 > worst.p99) worst.p99 = p99;
      if (p99 > worst.p99) worst.shape = name;
    }

    expect(worst.p99, `worst-shape p99 = ${worst.p99.toFixed(1)} ms`).toBeLessThanOrEqual(
      P99_BUDGET_MS
    );
  }, 60_000);
});
