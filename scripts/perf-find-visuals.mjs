#!/usr/bin/env node
// v0.9.2 Phase J / J1 — one-shot perf harness for find_visuals.
//
// Reads $MAGPIE_HOME (assumed already seeded via scripts/seed-bench.mjs),
// runs each of the 8 find-visuals shapes 50 times sequentially, emits
// p50/p99/p999 wall + EXPLAIN QUERY PLAN per shape.
//
// Decoupled from vitest so Owner can run against any seeded home without
// pulling the full test harness up. SQL shape logic mirrors
// src/store/visuals.ts buildSearchVisualsSql (kept in sync at audit time).
//
// Tarball allowlist (Phase B/S1) excludes scripts/ — Owner never sees this.
//
// Usage:
//   MAGPIE_HOME=$PWD/.tmp-perf-home node scripts/perf-find-visuals.mjs        # human table
//   MAGPIE_HOME=$PWD/.tmp-perf-home node scripts/perf-find-visuals.mjs --json # machine-readable

import Database from "better-sqlite3";
import { join } from "node:path";

const RUNS = 50;

const SHAPES = [
  // Leading-% LIKE — unfixable without FTS5. Documented finding (D3).
  { name: "title-LIKE", args: { query: "hero" } },
  { name: "title-LIKE+description", args: { query: "hero", match_description: true } },
  // Correlated EXISTS forces driver = v. Query-rewrite breaks tags-AND.
  { name: "tag-single", args: { tags: ["seed-bench-tag-hero"] } },
  {
    name: "tag-AND-three",
    args: { tags: ["seed-bench-tag-hero", "seed-bench-tag-final", "seed-bench-tag-wip"] },
  },
  // Index-driven shapes — must SEARCH v after migration 014.
  { name: "project-only", args: { project: "seed-bench-00-auth" } },
  { name: "starred", args: { starred: true } },
  { name: "type", args: { type: "html" } },
  {
    name: "combined-project+starred+tag",
    args: {
      project: "seed-bench-00-auth",
      starred: true,
      tags: ["seed-bench-tag-hero"],
    },
  },
];

function buildSearchVisualsSql(args) {
  const wheres = ["v.archived_at IS NULL"];
  const params = [];
  if (args.query && args.query.trim().length > 0) {
    const needle = `%${args.query.trim()}%`;
    if (args.match_description) {
      wheres.push("(v.title LIKE ? OR v.description LIKE ?)");
      params.push(needle, needle);
    } else {
      wheres.push("v.title LIKE ?");
      params.push(needle);
    }
  }
  if (args.project) {
    wheres.push("p.name = ?");
    wheres.push("p.archived_at IS NULL");
    params.push(args.project);
  }
  if (args.type) {
    wheres.push("v.type = ?");
    params.push(args.type);
  }
  if (args.source) {
    wheres.push("v.source = ?");
    params.push(args.source);
  }
  if (args.starred) {
    wheres.push("v.starred = 1");
  }
  const tagList = (args.tags && args.tags.length > 0
    ? args.tags
    : args.tag
    ? [args.tag]
    : []
  ).filter((t) => typeof t === "string" && t.length > 0);
  for (const name of tagList) {
    wheres.push(
      "EXISTS (SELECT 1 FROM visual_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.visual_id = v.id AND t.name = ?)"
    );
    params.push(name);
  }
  const sql = `
    SELECT v.*,
           p.name AS project_name,
           cv.render_status AS current_render_status,
           cv.version_num   AS thumb_version,
           COALESCE(
             (SELECT GROUP_CONCAT(t.name, ',')
                FROM visual_tags vt
                JOIN tags t ON t.id = vt.tag_id
               WHERE vt.visual_id = v.id),
             ''
           ) AS tag_names
    FROM visuals v
    JOIN projects p ON p.id = v.project_id
    LEFT JOIN versions cv ON cv.visual_id = v.id AND cv.version_num = v.current_ver
    WHERE ${wheres.join(" AND ")}
    ORDER BY v.updated_at DESC
    LIMIT 200
  `;
  return { sql, params };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.floor(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, idx)];
}

function vDriverLine(planRows) {
  const lines = planRows.map((r) => r.detail);
  return lines.find((l) => /\bSEARCH v\b|\bSCAN v\b/.test(l) && !/\bcv\b/.test(l)) ?? null;
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes("--json");
  const home = process.env.MAGPIE_HOME;
  if (!home) {
    console.error("[perf-find-visuals] MAGPIE_HOME not set; refusing to guess.");
    process.exit(2);
  }
  const dbPath = join(home, "db.sqlite");
  const db = new Database(dbPath, { readonly: true });
  db.pragma("query_only = ON");

  const totalVisuals = db.prepare("SELECT COUNT(*) c FROM visuals").get().c;
  const totalProjects = db.prepare("SELECT COUNT(*) c FROM projects").get().c;

  const results = [];
  for (const shape of SHAPES) {
    const { sql, params } = buildSearchVisualsSql(shape.args);
    const stmt = db.prepare(sql);
    const planRows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
    const driver = vDriverLine(planRows);

    // Warmup — first run pays page-cache cost. Drop it from samples.
    stmt.all(...params);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const rows = stmt.all(...params);
      const t1 = performance.now();
      samples.push(t1 - t0);
      if (i === 0 && Array.isArray(rows) && rows.length > 200) {
        throw new Error(`[perf-find-visuals] shape ${shape.name} returned > 200 rows: ${rows.length}`);
      }
    }
    samples.sort((a, b) => a - b);
    results.push({
      shape: shape.name,
      runs: RUNS,
      p50_ms: Number(percentile(samples, 0.5).toFixed(3)),
      p99_ms: Number(percentile(samples, 0.99).toFixed(3)),
      p999_ms: Number(percentile(samples, 0.999).toFixed(3)),
      max_ms: Number(samples[samples.length - 1].toFixed(3)),
      driver,
    });
  }

  db.close();

  if (wantJson) {
    console.log(JSON.stringify({
      home,
      visuals: totalVisuals,
      projects: totalProjects,
      runs_per_shape: RUNS,
      results,
    }, null, 2));
    return;
  }

  console.log(`[perf-find-visuals] home     ${home}`);
  console.log(`[perf-find-visuals] visuals  ${totalVisuals}`);
  console.log(`[perf-find-visuals] projects ${totalProjects}`);
  console.log(`[perf-find-visuals] runs     ${RUNS} per shape`);
  console.log("");
  const header = `${"shape".padEnd(34)} ${"p50".padStart(8)} ${"p99".padStart(8)} ${"p999".padStart(8)} ${"max".padStart(8)}   driver`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(
      `${r.shape.padEnd(34)} ${String(r.p50_ms).padStart(8)} ${String(r.p99_ms).padStart(8)} ${String(r.p999_ms).padStart(8)} ${String(r.max_ms).padStart(8)}   ${r.driver ?? "(no v-driver line)"}`
    );
  }
}

main();
