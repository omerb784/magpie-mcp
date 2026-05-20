#!/usr/bin/env node
// Repeatable benchmark harness for Windows Defender (or any AV) overhead on
// the Magpie test suite. Runs the unit suite (`npm test`) and the lifecycle
// e2e suite (`npm run test:e2e`) independently per "run", N runs total.
// Records per-suite wall-clock + exit code, prints median / p95 / min / max /
// mean across runs, and optionally writes a JSON blob for pasting into
// docs/v0.9.0/migration.md.
//
// Why two suites independent: there are 2 pre-existing render-queue flakes in
// src/render/index.test.ts that cause `npm test` to exit 1, which breaks the
// `npm run test:all` chain (npm test && npm run test:e2e). This script
// sidesteps that by timing each suite separately.
//
// Usage:
//   node scripts/measure-av-overhead.mjs [--runs=N] [--out=<path>] [--label=<text>]
//
// Defaults: --runs=5. No --out = stdout only.
//
// To compare AV on vs AV off on Windows:
//   1. Run once with Defender real-time scanning active:
//        node scripts/measure-av-overhead.mjs --runs=5 --label="av-on" --out=av-on.json
//   2. Add path exclusions (admin PowerShell):
//        Add-MpPreference -ExclusionPath "$PWD","$env:MAGPIE_HOME"
//   3. Run again:
//        node scripts/measure-av-overhead.mjs --runs=5 --label="av-off" --out=av-off.json
//   4. Remove exclusions when done:
//        Remove-MpPreference -ExclusionPath "$PWD","$env:MAGPIE_HOME"
//
// Diff the median total wall-clock between the two JSON blobs to get the AV
// cost. Paste both into migration.md AV section + compute percent overhead.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { hostname, platform, release } from "node:os";
import { argv, version, exit } from "node:process";

function parseArgs(args) {
  const out = { runs: 5, out: undefined, label: undefined };
  for (const a of args.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "runs") out.runs = Number(val);
    else if (key === "out") out.out = val;
    else if (key === "label") out.label = val;
  }
  if (!Number.isFinite(out.runs) || out.runs < 1) {
    console.error(`Invalid --runs: ${out.runs}`);
    exit(2);
  }
  return out;
}

function stats(durations) {
  if (durations.length === 0) {
    return { count: 0, medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0, meanMs: 0, stddevMs: 0 };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const p95Idx = Math.min(n - 1, Math.ceil(0.95 * n) - 1);
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return {
    count: n,
    medianMs: Math.round(median),
    p95Ms: Math.round(sorted[p95Idx]),
    minMs: min,
    maxMs: max,
    meanMs: Math.round(mean),
    stddevMs: Math.round(stddev),
  };
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function gitInfo() {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  return {
    sha: sha.status === 0 ? sha.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
  };
}

function timeRun(npm, args) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  // shell:true required on win32 for npm.cmd batch invocation.
  // DEP0190: pass single command string (not args array) when shell:true.
  // Args here are hardcoded literals from caller — no injection surface.
  const useShell = platform() === "win32";
  const result = useShell
    ? spawnSync(`${npm} ${args.join(" ")}`, {
        stdio: ["ignore", "ignore", "ignore"],
        shell: true,
      })
    : spawnSync(npm, args, {
        stdio: ["ignore", "ignore", "ignore"],
      });
  const durationMs = Date.now() - t0;
  return { startedAt, completedAt: new Date().toISOString(), durationMs, exitCode: result.status ?? -1 };
}

const opts = parseArgs(argv);
const npm = platform() === "win32" ? "npm.cmd" : "npm";

console.error(
  `[measure-av-overhead] platform=${platform()} ${release()} · host=${hostname()} · node=${version} · runs=${opts.runs}${opts.label ? ` · label=${opts.label}` : ""}`,
);

const runs = [];
for (let i = 0; i < opts.runs; i++) {
  console.error(`[measure-av-overhead] run ${i + 1}/${opts.runs}`);
  console.error(`  unit: npm test`);
  const unit = timeRun(npm, ["test"]);
  console.error(`  unit: exit=${unit.exitCode} duration=${formatMs(unit.durationMs)}`);
  console.error(`  e2e:  npm run test:e2e`);
  const e2e = timeRun(npm, ["run", "test:e2e"]);
  console.error(`  e2e:  exit=${e2e.exitCode} duration=${formatMs(e2e.durationMs)}`);
  const totalMs = unit.durationMs + e2e.durationMs;
  runs.push({ run: i + 1, unit, e2e, totalMs });
  console.error(`  total: ${formatMs(totalMs)}`);
}

const unitDurations = runs.map((r) => r.unit.durationMs);
const e2eDurations = runs.map((r) => r.e2e.durationMs);
const totalDurations = runs.map((r) => r.totalMs);

const unitFailures = runs.filter((r) => r.unit.exitCode !== 0).length;
const e2eFailures = runs.filter((r) => r.e2e.exitCode !== 0).length;

const report = {
  label: opts.label ?? null,
  platform: platform(),
  osRelease: release(),
  hostname: hostname(),
  node: version,
  git: gitInfo(),
  runs,
  stats: {
    unit: stats(unitDurations),
    e2e: stats(e2eDurations),
    total: stats(totalDurations),
  },
  failures: { unit: unitFailures, e2e: e2eFailures },
};

console.error("");
console.error("[measure-av-overhead] === Summary ===");
console.error(`  runs: ${runs.length}`);
console.error(`  unit failures: ${unitFailures}/${runs.length}${unitFailures > 0 ? " (expected: 2 pre-existing render-queue flakes)" : ""}`);
console.error(`  e2e failures:  ${e2eFailures}/${runs.length}`);
for (const [name, s] of /** @type {[string, ReturnType<typeof stats>][]} */ ([
  ["unit ", report.stats.unit],
  ["e2e  ", report.stats.e2e],
  ["total", report.stats.total],
])) {
  console.error(
    `  ${name} · median=${formatMs(s.medianMs)} · p95=${formatMs(s.p95Ms)} · min=${formatMs(s.minMs)} · max=${formatMs(s.maxMs)} · mean=${formatMs(s.meanMs)} ± ${formatMs(s.stddevMs)}`,
  );
}

if (opts.out) {
  writeFileSync(opts.out, JSON.stringify(report, null, 2));
  console.error(`[measure-av-overhead] wrote ${opts.out}`);
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
