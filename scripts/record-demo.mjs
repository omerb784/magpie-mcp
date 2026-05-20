#!/usr/bin/env node
// record-demo — drives the live Magpie dashboard through the launch-demo
// beats with puppeteer-core (system Chrome), captures PNG frames, then muxes
// them to MP4 + GIF via a static ffmpeg (ffmpeg-static, no system install).
//
// This records the PRODUCT-SIDE story (browse → preview → compare → formats).
// The "ask your agent" half lives in your AI host UI and is the Owner's to
// bookend if wanted; this script covers everything the dashboard shows.
//
// Prereqs:
//   - Magpie running on http://127.0.0.1:3737 with the staged demo content:
//       * pmlxSakZK3dI  (pricing page, v1 light → v2 dark)  ← compare beat
//       * linden-loaf   (7 visuals, one per format)         ← grid beat
//     Boot:  $env:MAGPIE_HOME="$PWD\.tmp-smoke-home"; npx magpie-mcp
//   - ffmpeg-static installed:  npm i --no-save ffmpeg-static
//   - Chrome on PATH or MAGPIE_CHROME_PATH set.
//
// Usage:
//   node scripts/record-demo.mjs
//   node scripts/record-demo.mjs --headed         (watch it drive)
//   node scripts/record-demo.mjs --visual <id>    (override compare visual)
//   node scripts/record-demo.mjs --fps 15 --keep  (keep frames)
//
// Outputs:
//   docs/marketing/launch/assets/magpie-demo.mp4   (Twitter / Reddit / site)
//   docs/marketing/launch/assets/magpie-demo.gif   (README / inline autoplay)
//
// Chrome detection mirrors scripts/capture-guide-screenshots.mjs.

import { existsSync, mkdirSync, rmSync, copyFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit, platform } from "node:process";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(ROOT, "docs", "marketing", "launch", "assets");

const args = argv.slice(2);
const has = (n) => args.includes(n);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] ?? ""); };

const BASE = flag("--base") || env.MAGPIE_BASE_URL || "http://127.0.0.1:3737";
const HEADED = has("--headed");
const KEEP = has("--keep");
const FPS = Number(flag("--fps") || 15);
const COMPARE_ID = flag("--visual") || "pmlxSakZK3dI";
// An HTML visual in the linden-loaf seed — used to select that project for the
// grid beats via ?visual= (the app reads ?visual= on init, not ?project=).
const LINDEN_HTML = flag("--grid-visual") || "JrCYE6QFdQCh";

// Capture at 1.5x for crisp text; ffmpeg downscales to 1280-wide output.
const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1.5 };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  for (const c of chromeCandidates()) if (c && existsSync(c)) return c;
  return null;
}

// End slate — brand mark + tagline + install. Rendered from a data: URL.
const END_SLATE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%}
  body{background:#1f2b80;color:#fff;display:flex;align-items:center;justify-content:center;
    font-family:'IBM Plex Sans',system-ui,'Segoe UI',sans-serif}
  .box{text-align:center}
  .bead{width:18px;height:18px;border-radius:50%;background:#d4a233;margin:0 auto 22px;box-shadow:0 0 0 8px rgba(212,162,51,.22)}
  h1{font-size:54px;margin:0;letter-spacing:-.02em}
  .t{font-size:24px;color:#dfe3fb;margin:14px 0 30px}
  .t b{color:#fff}
  code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:20px;background:rgba(255,255,255,.14);
    padding:8px 16px;border-radius:8px}
  .repo{margin-top:18px;font-size:16px;color:#aab2ec}
</style></head><body><div class="box">
  <div class="bead"></div>
  <h1>Magpie</h1>
  <div class="t"><b>Your loyal Magpie.</b><br>Lands every visual in the nest.</div>
  <code>npx magpie-mcp</code>
  <div class="repo">github.com/omerb784/magpie-mcp · MIT</div>
</div></body></html>`;

async function main() {
  const exe = resolveChrome();
  if (!exe) { console.error("Chrome not found. Set MAGPIE_CHROME_PATH."); exit(2); }
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    console.error("ffmpeg-static missing. Run: npm i --no-save ffmpeg-static"); exit(2);
  }
  try {
    const ping = await fetch(`${BASE}/health`);
    if (!ping.ok) console.warn(`! /health ${ping.status} — continuing`);
  } catch (e) {
    console.error(`Cannot reach Magpie at ${BASE}: ${e.message}`);
    console.error('Boot it:  $env:MAGPIE_HOME="$PWD\\.tmp-smoke-home"; npx magpie-mcp');
    exit(2);
  }

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const framesDir = join(tmpdir(), `magpie-demo-frames-${process.pid}-${Date.now()}`);
  mkdirSync(framesDir, { recursive: true });

  const profileDir = join(tmpdir(), `magpie-demo-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: HEADED ? false : "new",
    userDataDir: profileDir,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-device-scale-factor=1.5"],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  // Always rail the sidebar so the recording doesn't leak the project list.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("magpie.sidebar", "rail"); } catch (e) {}
  });

  let n = 0;
  async function snap() {
    const p = join(framesDir, `f-${String(n).padStart(5, "0")}.png`);
    await page.screenshot({ path: p });
    n++;
    return p;
  }
  // hold: snap once, then duplicate the file for the remaining frames (cheap).
  async function hold(frames) {
    const first = await snap();
    for (let i = 1; i < frames; i++) {
      const p = join(framesDir, `f-${String(n).padStart(5, "0")}.png`);
      copyFileSync(first, p); n++;
    }
  }
  async function setTheme(theme) {
    await page.evaluate((t) => { try { localStorage.setItem("magpie.theme", t); } catch (e) {} }, theme);
  }
  async function go(path, theme = "light") {
    await setTheme(theme);
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    // re-apply theme post-load (some routes read it on mount) then settle
    await page.evaluate((t) => { try { localStorage.setItem("magpie.theme", t); document.body && document.body.setAttribute("data-theme", t); } catch (e) {} }, theme);
    await sleep(900);
  }
  async function scrollBeat(frames, deltaY, x = 360, y = 380) {
    await page.mouse.move(x, y);
    for (let i = 0; i < frames; i++) {
      await page.mouse.wheel({ deltaY });
      await sleep(40);
      await snap();
    }
  }

  console.log(`record-demo · base ${BASE} · fps ${FPS} · compare ${COMPARE_ID}`);

  // Beat 1 — the library grid (diverse formats)
  console.log("  beat 1: library grid");
  // ?visual= selects the visual's PROJECT (linden-loaf) + opens the drawer;
  // Escape closes the drawer, leaving a clean linden-loaf grid (7 formats).
  await go(`/?visual=${LINDEN_HTML}`, "light");
  await page.keyboard.press("Escape");
  await sleep(500);
  await hold(Math.round(FPS * 1.1));

  // Beat 2 — the dark pricing page (v2) preview
  console.log("  beat 2: preview (dark v2)");
  await go(`/v/${COMPARE_ID}`, "dark");
  await hold(Math.round(FPS * 1.3));

  // Beat 3 — compare v1 light <-> v2 dark, scroll-synced (the money shot)
  console.log("  beat 3: compare light <-> dark");
  await go(`/compare/${COMPARE_ID}?a=1&b=2&mode=sxs`, "light");
  await hold(Math.round(FPS * 0.8));
  await scrollBeat(Math.round(FPS * 2.4), 55);
  await hold(Math.round(FPS * 0.7));

  // Beat 4 — back to the grid (it's a real library)
  console.log("  beat 4: library again");
  await go(`/?visual=${LINDEN_HTML}`, "light");
  await page.keyboard.press("Escape");
  await sleep(500);
  await hold(Math.round(FPS * 1.1));

  // Beat 5 — end slate
  console.log("  beat 5: end slate");
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(END_SLATE), { waitUntil: "load" });
  await sleep(500);
  await hold(Math.round(FPS * 1.6));

  await browser.close();
  console.log(`  captured ${n} frames`);

  // ---- mux ----
  const input = join(framesDir, "f-%05d.png");
  const mp4 = join(OUT, "magpie-demo.mp4");
  const gif = join(OUT, "magpie-demo.gif");
  const palette = join(framesDir, "palette.png");

  console.log("  encoding mp4...");
  execFileSync(ffmpegPath, [
    "-y", "-framerate", String(FPS), "-i", input,
    "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ], { stdio: "ignore" });

  console.log("  encoding gif (2-pass palette)...");
  execFileSync(ffmpegPath, [
    "-y", "-framerate", String(FPS), "-i", input,
    "-vf", "fps=" + FPS + ",scale=960:-1:flags=lanczos,palettegen=stats_mode=diff", palette,
  ], { stdio: "ignore" });
  execFileSync(ffmpegPath, [
    "-y", "-framerate", String(FPS), "-i", input, "-i", palette,
    "-lavfi", "fps=" + FPS + ",scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
    gif,
  ], { stdio: "ignore" });

  if (!KEEP) rmSync(framesDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });

  const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + " MB";
  console.log("");
  console.log(`  mp4 → ${mp4.replace(ROOT, ".")}  (${mb(mp4)})`);
  console.log(`  gif → ${gif.replace(ROOT, ".")}  (${mb(gif)})`);
  if (KEEP) console.log(`  frames kept → ${framesDir}`);
}

main().catch((e) => { console.error(e); exit(1); });
