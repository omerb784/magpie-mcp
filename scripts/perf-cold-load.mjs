#!/usr/bin/env node
// v0.9.2 Phase J / J3 — cold dashboard load harness.
//
// Launches a fresh headless Chrome via puppeteer-core, opens the running
// Magpie dashboard URL N=5 times (closing the page between each run to
// re-pay first-render + first-fetch cost), and captures FCP / LCP / TTI
// per run from PerformanceObserver + navigation timing entries.
//
// Targets a running Magpie dashboard — pass URL via $MAGPIE_DASHBOARD_URL
// or default http://127.0.0.1:3737/. Owner must have a Magpie instance
// running before invoking (`npx magpie-mcp` or via MCP server boot).
//
// Tarball allowlist (Phase B/S1) excludes scripts/ — Owner never sees this.
//
// Usage:
//   node scripts/perf-cold-load.mjs                    # human table
//   node scripts/perf-cold-load.mjs --json             # machine-readable
//   MAGPIE_DASHBOARD_URL=http://127.0.0.1:9999/ node scripts/perf-cold-load.mjs

import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const RUNS = 5;
const DEFAULT_URL = process.env.MAGPIE_DASHBOARD_URL ?? "http://127.0.0.1:3737/";

function chromeCandidates() {
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
    return [
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ];
}

function resolveChrome() {
  if (process.env.MAGPIE_CHROME_PATH && existsSync(process.env.MAGPIE_CHROME_PATH)) {
    return process.env.MAGPIE_CHROME_PATH;
  }
  for (const c of chromeCandidates()) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function captureRun(browser, url) {
  const page = await browser.newPage();
  // PerformanceObserver registration must happen pre-navigation.
  await page.evaluateOnNewDocument(() => {
    window.__j3_metrics = { fcp: null, lcp: null };
    try {
      const fcpObs = new PerformanceObserver((entries) => {
        for (const e of entries.getEntries()) {
          if (e.name === "first-contentful-paint") {
            window.__j3_metrics.fcp = e.startTime;
            fcpObs.disconnect();
            break;
          }
        }
      });
      fcpObs.observe({ type: "paint", buffered: true });

      const lcpObs = new PerformanceObserver((entries) => {
        const ents = entries.getEntries();
        // LCP fires multiple times; last is canonical.
        const last = ents[ents.length - 1];
        if (last) window.__j3_metrics.lcp = last.startTime;
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // observers unavailable; metrics stay null
    }
  });

  const navStart = Date.now();
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

  // Settle window for late LCP candidates + final TTI signal. The Long
  // Tasks API would be cleaner but isn't universally available; we proxy
  // TTI via networkidle0 + a 200 ms quiet window.
  await new Promise((r) => setTimeout(r, 200));

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      fcp: window.__j3_metrics?.fcp ?? null,
      lcp: window.__j3_metrics?.lcp ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      loadEvent: nav?.loadEventEnd ?? null,
    };
  });

  const wallMs = Date.now() - navStart;
  await page.close();
  return { ...data, wallMs };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.floor(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, idx)];
}

function summarise(values) {
  const filtered = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (filtered.length === 0) return { p50: null, max: null, count: 0 };
  const sorted = [...filtered].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    max: sorted[sorted.length - 1],
    count: filtered.length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes("--json");
  const url = DEFAULT_URL;

  const exe = resolveChrome();
  if (!exe) {
    console.error("[perf-cold-load] Chrome not found. Set MAGPIE_CHROME_PATH.");
    process.exit(2);
  }

  const profileDir = join(tmpdir(), `magpie-j3-profile-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    userDataDir: profileDir,
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });

  try {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await captureRun(browser, url);
      runs.push({ run: i + 1, ...r });
    }

    const fcpStats = summarise(runs.map((r) => r.fcp));
    const lcpStats = summarise(runs.map((r) => r.lcp));
    const dclStats = summarise(runs.map((r) => r.domContentLoaded));
    const loadStats = summarise(runs.map((r) => r.loadEvent));
    const wallStats = summarise(runs.map((r) => r.wallMs));

    if (wantJson) {
      console.log(JSON.stringify({
        url,
        runs,
        summary: {
          fcp: fcpStats,
          lcp: lcpStats,
          domContentLoaded: dclStats,
          loadEvent: loadStats,
          wallTotal: wallStats,
        },
      }, null, 2));
      return;
    }

    console.log(`[perf-cold-load] url   ${url}`);
    console.log(`[perf-cold-load] runs  ${RUNS}`);
    console.log("");
    console.log(`${"run".padStart(3)}  ${"FCP".padStart(8)}  ${"LCP".padStart(8)}  ${"DCL".padStart(8)}  ${"load".padStart(8)}  ${"wall".padStart(8)}`);
    console.log("-".repeat(60));
    for (const r of runs) {
      const fcp = r.fcp != null ? r.fcp.toFixed(1) : "n/a";
      const lcp = r.lcp != null ? r.lcp.toFixed(1) : "n/a";
      const dcl = r.domContentLoaded != null ? r.domContentLoaded.toFixed(1) : "n/a";
      const ld = r.loadEvent != null ? r.loadEvent.toFixed(1) : "n/a";
      console.log(`${String(r.run).padStart(3)}  ${fcp.padStart(8)}  ${lcp.padStart(8)}  ${dcl.padStart(8)}  ${ld.padStart(8)}  ${String(r.wallMs).padStart(8)}`);
    }
    console.log("");
    const fmt = (s) =>
      s.count === 0 ? "n/a" : `p50=${s.p50.toFixed(1)} · max=${s.max.toFixed(1)}`;
    console.log(`FCP   ${fmt(fcpStats)} ms`);
    console.log(`LCP   ${fmt(lcpStats)} ms`);
    console.log(`DCL   ${fmt(dclStats)} ms`);
    console.log(`load  ${fmt(loadStats)} ms`);
    console.log(`wall  ${fmt(wallStats)} ms (navStart → close)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[perf-cold-load] error:", err);
  process.exit(1);
});
