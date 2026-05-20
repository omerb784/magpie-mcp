#!/usr/bin/env node
// visual-to-pdf — render any Magpie visual as a single multi-panel PDF.
//
// Use case: upload a rich HTML mock (e.g. tool guides, audit summaries) to a
// tool that accepts PDF but not HTML (NotebookLM, Notion, email). Walks every
// JS-driven panel in the visual, triggers mermaid render, stacks them all in
// one flow with clean page breaks, and prints via puppeteer-core + system
// Chrome.
//
// Usage:
//   node scripts/visual-to-pdf.mjs <visual_id> [--out file.pdf] [--port N] [--host H]
//
// Examples:
//   node scripts/visual-to-pdf.mjs TP5fPdEZHT9g
//   node scripts/visual-to-pdf.mjs TP5fPdEZHT9g --out ~/Desktop/tool-guides.pdf
//
// The script reads the live dashboard port from ~/.magpie/last-port (override
// with --port). Requires Magpie running locally; if the dashboard isn't up,
// boot it with `npm run dev` first.
//
// Chrome detection mirrors src/render/browser.ts — same candidate paths,
// MAGPIE_CHROME_PATH env override honored.

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { argv, env, exit, cwd } from "node:process";
import puppeteer from "puppeteer-core";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") out.out = argv[++i];
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) {
      console.error(`unknown flag: ${a}`);
      exit(2);
    } else {
      out._.push(a);
    }
  }
  return out;
}

const HELP = `visual-to-pdf — render any Magpie visual as a multi-panel PDF.

Usage:
  node scripts/visual-to-pdf.mjs <visual_id> [options]

Options:
  --out, -o <path>   Output PDF path. Default: ./<visual_id>.pdf
  --port, -p <n>     Dashboard port. Default: read ~/.magpie/last-port
  --host <ip>        Dashboard host. Default: 127.0.0.1
  --help, -h         Show this message

The visual must already be saved in Magpie. Magpie's dashboard server must be
running. Panels are walked in DOM order; mermaid diagrams render before
capture; page-breaks between panels for clean pagination.
`;

const args = parseArgs(argv.slice(2));
if (args.help || args._.length !== 1) {
  process.stdout.write(HELP);
  exit(args.help ? 0 : 2);
}
const visualId = args._[0];

const host = args.host ?? "127.0.0.1";
const port = await resolvePort(args.port, host);
if (!port) {
  console.error("Magpie dashboard not reachable. Boot it with `npm start` or pass --port.");
  exit(1);
}

const outPath = resolveOut(args.out ?? `${visualId}.pdf`);
mkdirSync(dirname(outPath), { recursive: true });

// `?chrome=0` bypasses the dashboard chrome shell and serves the raw visual
// body — same surface the dashboard's iframe loads.
const url = `http://${host}:${port}/v/${visualId}?chrome=0`;
console.error(`[visual-to-pdf] source: ${url}`);
console.error(`[visual-to-pdf] target: ${outPath}`);

const exe = resolveChromePath();
if (!exe) {
  console.error("Chrome not found. Install Chrome or set MAGPIE_CHROME_PATH.");
  exit(1);
}

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  const resp = await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  if (!resp || !resp.ok()) {
    throw new Error(`failed to load ${url} (status ${resp?.status() ?? "n/a"})`);
  }

  // Probe for the .panel system. Not every Magpie visual uses it — single-page
  // visuals (overviews, status pages) just render top-down. Non-throwing wait
  // with a short ceiling: if .panel appears within 2s we walk it; otherwise we
  // treat the page as a single-flow capture.
  await page
    .waitForFunction(
      () => typeof window !== "undefined" && document.querySelectorAll(".panel").length > 0,
      { timeout: 2000 }
    )
    .catch(() => {});

  const panelIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".panel"))
      .map((p) => p.id.replace(/^tool-/, ""))
      .filter(Boolean);
  });
  console.error(`[visual-to-pdf] panels: ${panelIds.length}`);
  if (!panelIds.length) {
    console.error("[visual-to-pdf] no .panel elements — single-page capture mode.");
  }

  // Walk every panel so mermaid renders fire. The mock's showTool() lazily
  // renders diagrams on visibility — without this loop, hidden panels print
  // as raw code blocks.
  for (const id of panelIds) {
    await page.evaluate((id) => {
      if (typeof window.showTool === "function") {
        window.showTool(id);
      } else {
        location.hash = `#${id}`;
      }
    }, id);
    // Give mermaid + any sticky-nav transitions a beat to settle
    await page.waitForFunction(
      (id) => {
        const p = document.getElementById(`tool-${id}`);
        if (!p) return true;
        const undone = p.querySelectorAll(".mermaid:not([data-rendered])");
        return undone.length === 0;
      },
      { timeout: 8000 },
      id
    ).catch(() => {
      console.error(`[visual-to-pdf] mermaid render timeout for panel "${id}" — continuing`);
    });
  }

  // Inject print-friendly CSS. The visual decides its own background +
  // colour palette — never override `body { background }` here, that
  // forces dark onto light-themed visuals and breaks their contrast.
  // Selectors below are namespaced to the panel system and to v4/v5
  // mock chrome; they're no-ops on visuals that don't use them.
  await page.addStyleTag({
    content: `
      .panel { display: block !important; }
      .panel + .panel { page-break-before: always; break-before: page; padding-top: 32px; }
      header.top, nav.cats, nav.tools { position: static !important; top: auto !important; }
      nav.tools { display: none !important; }
      main.body { max-width: none; padding: 24px 32px; }
      @page { size: A4; margin: 14mm 12mm; }
      /* Avoid splitting cards mid-row */
      .card, .stat, .primitive, .qcard, pre, table,
      .pane, .step, .release, .fmt, .design-pane, .chip { break-inside: avoid; page-break-inside: avoid; }
      /* Keep section headings with their content (no orphan h2 at page bottom) */
      h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    `,
  });

  // One more pass: scroll through document so any lazy-rendered mermaid in
  // mid-page panels has a chance to finalize layout
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });

  await page.emulateMediaType("screen");
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font:10px ui-monospace,monospace;color:#8a8f98;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>magpie-mcp · ${escape(visualId)}</span><span class="date"></span></div>`,
    footerTemplate: `<div style="font:10px ui-monospace,monospace;color:#8a8f98;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span></span><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  });

  console.error(`[visual-to-pdf] ok: ${outPath}`);
} finally {
  await browser.close();
}

// ─── helpers ──────────────────────────────────────────────────────────

function readLastPort() {
  const home = env.MAGPIE_HOME ?? join(homedir(), ".magpie");
  const f = join(home, "last-port");
  if (!existsSync(f)) return null;
  const n = Number(readFileSync(f, "utf8").trim());
  return Number.isInteger(n) ? n : null;
}

async function probe(host, port) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 500);
    const r = await fetch(`http://${host}:${port}/health`, { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function resolvePort(explicit, host) {
  if (explicit) {
    if (await probe(host, explicit)) return explicit;
    console.error(`[visual-to-pdf] --port ${explicit} not responding on /health`);
    return null;
  }
  const candidates = [readLastPort(), 3737, 3736, 3738, 3739].filter(Boolean);
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (await probe(host, p)) {
      console.error(`[visual-to-pdf] dashboard on :${p}`);
      return p;
    }
  }
  return null;
}

function resolveOut(input) {
  return isAbsolute(input) ? input : resolve(cwd(), input);
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function resolveChromePath() {
  if (env.MAGPIE_CHROME_PATH && existsSync(env.MAGPIE_CHROME_PATH)) return env.MAGPIE_CHROME_PATH;
  for (const c of chromeCandidates()) {
    if (existsSync(c)) return c;
  }
  return null;
}

function chromeCandidates() {
  if (process.platform === "win32") {
    const pf = env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
    return [
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}
