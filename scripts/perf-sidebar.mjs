#!/usr/bin/env node
// v0.9.2 Phase J / J5 — sidebar paint + DOM count + scroll-jank probe.
//
// Pairs with `scripts/seed-projects.mjs` — seed N projects first (default 50),
// then run this harness against the running dashboard to measure how the
// project sidebar behaves at scale.
//
// Captures:
//   - sidebarPaintMs   — time from navigation start until the .sidebar
//                        element's last layout pass settles
//   - navItemCount     — visible .nav-item-wrap elements
//   - domNodeCount     — total nodes under the .sidebar subtree
//   - scrollJank       — longtask count + max longtask duration during a
//                        scripted 1 s scroll over the sidebar
//
// Read-only: harness never writes to the DB or triggers MCP mutations.
//
// Tarball allowlist (Phase B/S1) excludes scripts/ — Owner never sees this.
//
// Usage:
//   node scripts/perf-sidebar.mjs              # human table
//   node scripts/perf-sidebar.mjs --json       # machine-readable
//   MAGPIE_DASHBOARD_URL=... node scripts/perf-sidebar.mjs

import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

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

async function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes("--json");
  const url = DEFAULT_URL;

  const exe = resolveChrome();
  if (!exe) {
    console.error("[perf-sidebar] Chrome not found. Set MAGPIE_CHROME_PATH.");
    process.exit(2);
  }

  const profileDir = join(tmpdir(), `magpie-j5-profile-${process.pid}-${Date.now()}`);
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
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    await page.evaluateOnNewDocument(() => {
      window.__j5 = { longtasks: [] };
      try {
        const ltObs = new PerformanceObserver((entries) => {
          for (const e of entries.getEntries()) {
            window.__j5.longtasks.push({ duration: e.duration, startTime: e.startTime });
          }
        });
        ltObs.observe({ type: "longtask", buffered: true });
      } catch {
        // longtask API unavailable
      }
    });

    const navStart = Date.now();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

    // Wait for sidebar to mount + project list to render.
    await page.waitForSelector(".sidebar", { timeout: 10_000 });
    await page.waitForFunction(
      () => document.querySelectorAll(".sidebar .nav-item-wrap").length > 0,
      { timeout: 10_000 },
    );

    // Settle window — let React's final layout pass complete.
    await new Promise((r) => setTimeout(r, 300));

    const initialMetrics = await page.evaluate(() => {
      const sb = document.querySelector(".sidebar");
      const navItems = document.querySelectorAll(".sidebar .nav-item-wrap");
      const allNodes = sb ? sb.querySelectorAll("*").length : 0;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      return {
        navItemCount: navItems.length,
        domNodeCount: allNodes,
        sidebarBoundingHeight: sb ? sb.getBoundingClientRect().height : null,
        fcp,
      };
    });

    const sidebarMountMs = Date.now() - navStart;

    // Snapshot longtasks pre-scroll so we can attribute jank to the
    // scroll window specifically.
    const preScrollLT = await page.evaluate(() => window.__j5.longtasks.slice());

    // Scripted scroll — 50 step over 1000 ms (20 ms cadence). Picks up
    // jank from re-layout / event-handler thrash if any.
    await page.evaluate(async () => {
      const sb = document.querySelector(".sidebar");
      if (!sb) return;
      const stepMs = 20;
      const totalSteps = 50;
      const scrollHeight = sb.scrollHeight - sb.clientHeight;
      if (scrollHeight <= 0) return;
      for (let i = 0; i <= totalSteps; i++) {
        sb.scrollTop = Math.floor((scrollHeight * i) / totalSteps);
        await new Promise((r) => setTimeout(r, stepMs));
      }
    });

    // Drain remaining longtasks.
    await new Promise((r) => setTimeout(r, 200));

    const postScrollLT = await page.evaluate(() => window.__j5.longtasks.slice());

    const scrollLT = postScrollLT.slice(preScrollLT.length);
    const longtaskCount = scrollLT.length;
    const maxLongtaskMs = scrollLT.reduce((m, t) => Math.max(m, t.duration), 0);

    const summary = {
      url,
      sidebarMountMs,
      ...initialMetrics,
      scroll: {
        longtaskCount,
        maxLongtaskMs,
        longtasks: scrollLT,
      },
      virtualizationRecommendation:
        initialMetrics.domNodeCount > 5000 || maxLongtaskMs > 50 || sidebarMountMs > 2500
          ? "consider-virtualization-v093"
          : "no-virtualization-needed-at-v1",
    };

    if (wantJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`[perf-sidebar] url                ${url}`);
      console.log(`[perf-sidebar] sidebarMountMs     ${summary.sidebarMountMs} ms`);
      console.log(`[perf-sidebar] navItemCount       ${summary.navItemCount}`);
      console.log(`[perf-sidebar] domNodeCount       ${summary.domNodeCount} (under .sidebar)`);
      console.log(`[perf-sidebar] sidebarHeight      ${summary.sidebarBoundingHeight} px`);
      console.log(`[perf-sidebar] FCP                ${summary.fcp != null ? summary.fcp.toFixed(1) + " ms" : "n/a"}`);
      console.log(`[perf-sidebar] scroll longtasks   ${longtaskCount}`);
      console.log(`[perf-sidebar] scroll max LT      ${maxLongtaskMs.toFixed(1)} ms`);
      console.log(`[perf-sidebar] virtualization     ${summary.virtualizationRecommendation}`);
    }

    await page.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[perf-sidebar] error:", err);
  process.exit(1);
});
