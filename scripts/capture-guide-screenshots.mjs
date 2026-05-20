#!/usr/bin/env node
// capture-guide-screenshots — drives Chrome via puppeteer-core to refresh
// the 17 dashboard PNGs the user guide references (15 dashboard panels +
// 17 outbox-kanban + 18 templates-list · panel 07 dropped 2026-05-19).
//
// Prereqs: Magpie running on http://127.0.0.1:3737 with seed bundle loaded
// (Library → Load example, or POST /api/seed/load-example).
//
// Usage:    node scripts/capture-guide-screenshots.mjs
//           node scripts/capture-guide-screenshots.mjs --base http://127.0.0.1:3838
//           node scripts/capture-guide-screenshots.mjs --only 01,02,04
//           node scripts/capture-guide-screenshots.mjs --headed   (show window)
//
// Outputs (overwrites in place):
//   site/assets/dashboard/<id>-<slug>.png    (public site copy)
//   seed/user-guide/assets/<id>-<slug>.png   (in-product /guide copy)
//
// Auto-discovers visual IDs per format from /api/visuals so panels 05-16
// retarget to whatever the current library holds. If a format is missing
// from the library, that panel is skipped with a notice (load the seed
// bundle to ensure all 7 formats are present).
//
// Chrome detection mirrors scripts/perf-sidebar.mjs + visual-to-pdf.mjs.
// MAGPIE_CHROME_PATH env override honored.

import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit, platform } from "node:process";
import puppeteer from "puppeteer-core";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SITE_OUT = join(ROOT, "site", "assets", "dashboard");
const SEED_OUT = join(ROOT, "seed", "user-guide", "assets");

const args = argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? "";
}
function has(name) { return args.includes(name); }

const BASE = flag("--base") || env.MAGPIE_BASE_URL || "http://127.0.0.1:3737";
const ONLY = (flag("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const HEADED = has("--headed");

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
const SETTLE_MS = 600;

// ---------------------------------------------------------------------------
// Discovery — query Magpie for one visual per format + one with ≥2 versions
// ---------------------------------------------------------------------------

async function discover() {
  const res = await fetch(`${BASE}/api/visuals`);
  if (!res.ok) throw new Error(`/api/visuals returned ${res.status}`);
  const visuals = await res.json();
  if (!Array.isArray(visuals)) throw new Error("/api/visuals: not an array");

  const byType = new Map();
  for (const v of visuals) {
    if (!byType.has(v.type)) byType.set(v.type, v);
  }

  // Find a visual with ≥2 versions for compare panels.
  // /api/visuals returns current_ver on every entry — no second fetch needed.
  let multiVersion = null;
  for (const v of visuals) {
    if (typeof v.current_ver === "number" && v.current_ver >= 2) {
      multiVersion = { id: v.id, count: v.current_ver, type: v.type };
      break;
    }
  }

  return {
    byType,            // Map<type, visual>
    multiVersion,      // { id, count, type } | null
    htmlOne: byType.get("html"),
    anyOne: visuals[0],
  };
}

// ---------------------------------------------------------------------------
// Manifest — every entry AUTO; recipes reference discovered IDs at runtime.
// ---------------------------------------------------------------------------

function buildManifest(d) {
  /** helper: pick a visual of type t · returns null if missing */
  const fmtVisual = (t) => d.byType.get(t) ?? null;

  return [
    {
      id: "01", slug: "dashboard-light",
      url: () => "/",
      theme: "light",
    },
    {
      id: "02", slug: "dashboard-dark",
      url: () => "/",
      theme: "dark",
    },
    {
      id: "03", slug: "shortcuts-overlay",
      url: () => "/",
      theme: "light",
      prep: async (page) => {
        await page.focus("body").catch(() => {});
        await page.keyboard.down("Shift");
        await page.keyboard.press("Slash"); // = ?
        await page.keyboard.up("Shift");
        await sleep(350);
      },
    },
    {
      id: "04", slug: "grid-all",
      url: () => "/",
      theme: "light",
    },
    {
      id: "05", slug: "drawer-html",
      url: () => d.htmlOne ? `/?visual=${encodeURIComponent(d.htmlOne.id)}` : null,
      theme: "light",
      missingNote: "no HTML visual in library",
    },
    {
      id: "06", slug: "compare-side-by-side",
      url: () => d.multiVersion ? `/compare/${encodeURIComponent(d.multiVersion.id)}?a=1&b=${d.multiVersion.count}&mode=sxs` : null,
      theme: "light",
      missingNote: "no visual with ≥2 versions in library (iterate one in dashboard, then re-run)",
    },
    // 07 (compare-overlay) intentionally dropped — overlay mode renders
    // poorly with same-format content overlapping (Owner decision 2026-05-19).
    // Guide references to overlay also removed; sxs is the recommended mode.
    {
      id: "08", slug: "send-to-claude",
      url: () => d.htmlOne ? `/?visual=${encodeURIComponent(d.htmlOne.id)}` : null,
      theme: "light",
      missingNote: "no HTML visual in library",
      prep: async (page) => {
        // Drawer opens via ?visual= URL param. Now click Talk-with-agent button.
        // No data-testid in UI; match button by visible text.
        await sleep(400);
        const clicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const target = btns.find((b) => /talk with agent/i.test(b.textContent || ""));
          if (target) { target.click(); return true; }
          return false;
        });
        if (!clicked) throw new Error("Talk-with-agent button not found in drawer");
        await sleep(350);
      },
    },
    {
      id: "09", slug: "type-filter-mermaid",
      url: () => "/",
      theme: "light",
      prep: async (page) => {
        // No dedicated "type filter" UI in the current dashboard — the old
        // 09 PNG predates a refactor. Closest live equivalent: search for
        // "mermaid" via the top search bar (the guide uses this image to
        // illustrate filtering, so search-by-typing tells the same story).
        await sleep(300);
        await page.keyboard.press("Slash"); // `/` focuses search input
        await sleep(200);
        await page.keyboard.type("mermaid", { delay: 30 });
        await sleep(600); // let search results refresh
      },
    },
    {
      id: "10", slug: "preview-shell",
      url: () => d.anyOne ? `/v/${encodeURIComponent(d.anyOne.id)}` : null,
      theme: "light",
      missingNote: "library is empty",
    },
    ...["vega-lite", "d2", "dot", "markdown", "svg", "mermaid"].map((type, i) => {
      const ids = ["11", "12", "13", "14", "15", "16"];
      const slugs = {
        "vega-lite": "format-vega",
        "d2":        "format-d2",
        "dot":       "format-dot",
        "markdown":  "format-markdown",
        "svg":       "format-svg",
        "mermaid":   "format-mermaid",
      };
      return {
        id: ids[i],
        slug: slugs[type],
        url: () => {
          const v = fmtVisual(type);
          return v ? `/v/${encodeURIComponent(v.id)}` : null;
        },
        theme: "light",
        missingNote: `no '${type}' visual in library`,
      };
    }),
    {
      id: "17", slug: "outbox-kanban",
      // /outbox isn't a URL route — Outbox is a sidebar tab that swaps the
      // main column. Boot at /, seed entries if empty, then click the nav
      // button to switch to the Outbox view.
      url: () => "/",
      theme: "light",
      prep: async (page) => {
        const baseUrl = BASE;
        const htmlVisualId = d.htmlOne ? d.htmlOne.id : null;
        if (!htmlVisualId) throw new Error("no HTML visual in library");
        const empty = await page.evaluate(async (b) => {
          try {
            const r = await fetch(`${b}/api/inbox?status=pending`);
            const j = await r.json();
            return !Array.isArray(j.entries) || j.entries.length === 0;
          } catch (e) { return false; }
        }, baseUrl);
        if (empty) {
          await page.evaluate(async (b, vid) => {
            const entries = [
              {
                visual_id: vid,
                template_id: "builtin-iterate",
                prompt_body: `Iterate on magpie://visual/${vid}: tighten line-item spacing, push the total down 4px, soften the gold band by 6%.`,
                vars: { focus: "spacing" },
              },
              {
                visual_id: vid,
                template_id: "builtin-variants",
                prompt_body: `Three variants of the order card from magpie://visual/${vid}: minimalist (no border), print-receipt (mono everywhere), bakery-warm (cream paper, hand-drawn underline).`,
                vars: {},
              },
            ];
            for (const e of entries) {
              await fetch(`${b}/api/inbox`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(e),
              });
            }
          }, baseUrl, htmlVisualId);
          await sleep(400);
        }
        // Click the sidebar Outbox nav button — matched by its title attr
        // which is stable across rail/expanded modes.
        const clicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button.nav-item"));
          const target = btns.find((b) => /queued prompts/i.test(b.title || ""));
          if (target) { target.click(); return true; }
          return false;
        });
        if (!clicked) throw new Error("Outbox sidebar button not found");
        await sleep(500);
      },
      missingNote: "no HTML visual in library — load the linden-loaf seed first",
    },
    {
      id: "18", slug: "templates-list",
      url: () => "/templates",
      theme: "light",
      // /templates always shows the 10 builtins so no prep needed.
    },
  ];
}

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

function chromeCandidates() {
  if (platform === "win32") {
    return [
      env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe",
      env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe",
      env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}

function resolveChrome() {
  if (env.MAGPIE_CHROME_PATH && existsSync(env.MAGPIE_CHROME_PATH)) return env.MAGPIE_CHROME_PATH;
  for (const c of chromeCandidates()) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function capturePanel(browser, panel) {
  const url = panel.url();
  if (!url) {
    return { skipped: true, reason: panel.missingNote || "url() returned null" };
  }

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Always collapse sidebar to "rail" so the screenshot doesn't leak the
  // Owner's actual project list. Theme set per-panel; matches the real key
  // (`magpie.theme`) the dashboard reads on boot, applied to <body>.
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem("magpie.sidebar", "rail"); } catch (e) {}
    if (t) {
      try { localStorage.setItem("magpie.theme", t); } catch (e) {}
    }
  }, panel.theme || "light");

  const fullUrl = url.startsWith("http") ? url : `${BASE}${url}`;
  await page.goto(fullUrl, { waitUntil: "networkidle2", timeout: 25000 });
  await sleep(SETTLE_MS);

  if (panel.prep) {
    try { await panel.prep(page); } catch (e) {
      await page.close();
      throw e;
    }
  }

  const fileName = `${panel.id}-${panel.slug}.png`;
  const sitePath = join(SITE_OUT, fileName);
  const seedPath = join(SEED_OUT, fileName);
  await page.screenshot({ path: sitePath, fullPage: false });
  await page.screenshot({ path: seedPath, fullPage: false });
  await page.close();
  return { sitePath, seedPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(SITE_OUT)) mkdirSync(SITE_OUT, { recursive: true });
  if (!existsSync(SEED_OUT)) mkdirSync(SEED_OUT, { recursive: true });

  const exe = resolveChrome();
  if (!exe) {
    console.error("Chrome not found. Install Chrome or set MAGPIE_CHROME_PATH.");
    exit(2);
  }

  // Probe Magpie reachability
  try {
    const ping = await fetch(`${BASE}/health`);
    if (!ping.ok) console.warn(`⚠ /health returned ${ping.status} — continuing anyway`);
  } catch (e) {
    console.error(`Cannot reach Magpie at ${BASE}: ${e.message}`);
    console.error("Boot Magpie first:  npx magpie-mcp");
    exit(2);
  }

  console.log("Discovering visuals via /api/visuals...");
  const d = await discover();
  const fmtsFound = Array.from(d.byType.keys()).sort().join(", ");
  console.log(`  formats present: ${fmtsFound || "(none)"}`);
  if (d.multiVersion) {
    console.log(`  multi-version: ${d.multiVersion.id} (${d.multiVersion.count} versions, type=${d.multiVersion.type})`);
  } else {
    console.log("  multi-version: none found · compare panels 06/07 will skip");
  }
  console.log("");

  const manifest = buildManifest(d);
  const target = ONLY.length
    ? manifest.filter((p) => ONLY.includes(p.id))
    : manifest;

  const profileDir = join(tmpdir(), `magpie-capture-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: HEADED ? false : "new",
    userDataDir: profileDir,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  console.log(`magpie capture · base ${BASE} · ${target.length} panel(s)`);
  console.log("");

  let ok = 0, skipped = 0, failed = 0;
  for (const panel of target) {
    process.stdout.write(`  - ${panel.id} ${panel.slug.padEnd(24)} `);
    try {
      const result = await capturePanel(browser, panel);
      if (result.skipped) {
        console.log(`skip · ${result.reason}`);
        skipped++;
      } else {
        const rel = result.sitePath.replace(ROOT + "/", "").replace(ROOT + "\\", "");
        console.log(`ok   → ${rel}`);
        ok++;
      }
    } catch (e) {
      console.log(`FAIL · ${e.message}`);
      failed++;
    }
  }

  await browser.close();

  console.log("");
  console.log(`Captured ${ok} · skipped ${skipped} · failed ${failed}`);
  if (skipped) {
    console.log("→ skips usually mean the library is missing visuals of that type.");
    console.log("  load the seed bundle (Library → Load example) and re-run.");
  }
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
