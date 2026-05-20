#!/usr/bin/env node
// render-brand-banners — re-render the 5 wordmark banners with licensed
// IBM Plex Sans 600 + Newsreader italic faces. Replaces the system-fallback
// (Segoe UI) renders that shipped in the F2 handover bundle.
//
// Outputs (overwrites in place):
//   assets/brand/web/readme/readme-header-1280x320.png
//   assets/brand/web/readme/readme-header-dark-1280x320.png
//   assets/brand/web/readme/github-social-preview-1280x640.png
//   assets/brand/web/og/og-image-1200x630.png
//   assets/brand/web/og/og-image-dark-1200x630.png
// Mirrors og-image-1200x630.png -> ui/public/og/og-image.png.
//
// Q4 lock (v0.9.3 Phase F, 2026-05-18): wordmark re-render uses licensed
// Plex 600 (ss01 + cv11) + Newsreader italic, served from Google Fonts.
//
// Usage:  node scripts/render-brand-banners.mjs
//
// Chrome detection mirrors scripts/visual-to-pdf.mjs + src/render/browser.ts.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env, exit } from "node:process";
import puppeteer from "puppeteer-core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const README_DIR = join(ROOT, "assets", "brand", "web", "readme");
const OG_DIR = join(ROOT, "assets", "brand", "web", "og");
const UI_PUBLIC_OG = join(ROOT, "ui", "public", "og");

// Brand tokens — pulled verbatim from ui/src/index.css :root block.
const TOKENS = {
  cobalt: "#1f2b80",
  shiny: "#d4a233",
  terra: "#c25d3a",
  ink: "#0e0f14",
  paper: "#eef0f4",
  paperDark: "#0c0e16",
  surfaceDark: "#141826",
  inkDark: "#eef0f4",
  textMute: "#5a5e6d",
  textMuteDark: "#a3a8bb",
};

const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@1,6..72,400;1,6..72,500&display=swap" rel="stylesheet" />`;

function bannerHtml({ width, height, dark = false, layout = "readme" }) {
  const bg = dark ? TOKENS.paperDark : TOKENS.paper;
  const ink = dark ? TOKENS.inkDark : TOKENS.ink;
  const mute = dark ? TOKENS.textMuteDark : TOKENS.textMute;
  const subStripe = dark ? TOKENS.surfaceDark : "#ffffff";
  // Layouts:
  //   readme  · horizontal mark + wordmark on left, tagline italic right of stack
  //   ogcard  · centered stack, mark above, tagline below
  //   social  · centered, sized larger (GitHub social preview)
  const isCenter = layout !== "readme";
  const markPx = layout === "social" ? 200 : layout === "ogcard" ? 160 : 112;
  const wordmarkPx = layout === "social" ? 132 : layout === "ogcard" ? 108 : 88;
  const taglinePx = layout === "social" ? 36 : layout === "ogcard" ? 30 : 24;
  return `<!doctype html><html><head><meta charset="utf-8" />${FONT_LINK}
<style>
  html, body { margin: 0; padding: 0; background: ${bg}; }
  body {
    width: ${width}px; height: ${height}px;
    display: flex; align-items: center; justify-content: ${isCenter ? "center" : "flex-start"};
    padding: ${isCenter ? 0 : `0 ${Math.round(width * 0.06)}px`};
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    color: ${ink};
    box-sizing: border-box;
  }
  .stack {
    display: flex;
    flex-direction: ${isCenter ? "column" : "row"};
    align-items: ${isCenter ? "center" : "center"};
    gap: ${isCenter ? "24px" : "32px"};
    text-align: ${isCenter ? "center" : "left"};
  }
  .mark {
    width: ${markPx}px; height: ${markPx}px;
    flex: 0 0 auto;
  }
  .text {
    display: flex; flex-direction: column;
    gap: ${isCenter ? "14px" : "10px"};
    align-items: ${isCenter ? "center" : "flex-start"};
    min-width: 0;
  }
  .wordmark {
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    font-weight: 600;
    font-size: ${wordmarkPx}px;
    font-feature-settings: "ss01" 1, "cv11" 1;
    letter-spacing: -0.022em;
    line-height: 1;
    color: ${ink};
    white-space: nowrap;
  }
  .wordmark::after {
    content: "";
    display: inline-block;
    width: ${Math.round(wordmarkPx * 0.13)}px;
    height: ${Math.round(wordmarkPx * 0.13)}px;
    background: ${TOKENS.terra};
    border-radius: 50%;
    margin-left: ${Math.round(wordmarkPx * 0.05)}px;
    vertical-align: ${Math.round(wordmarkPx * 0.04)}px;
  }
  .tagline {
    font-family: "Newsreader", "Iowan Old Style", Georgia, serif;
    font-style: italic;
    font-weight: 400;
    font-size: ${taglinePx}px;
    line-height: 1.25;
    color: ${TOKENS.cobalt};
    letter-spacing: -0.005em;
    max-width: ${isCenter ? `${Math.round(width * 0.78)}px` : `${Math.round(width * 0.55)}px`};
  }
</style></head><body>
  <div class="stack">
    <svg class="mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="${TOKENS.cobalt}" />
      <circle cx="44" cy="22" r="6" fill="${TOKENS.shiny}" />
      <path d="M16 38 Q26 28 36 38 T56 38" stroke="${subStripe}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.85" />
    </svg>
    <div class="text">
      <div class="wordmark">Magpie</div>
      <div class="tagline">Your loyal Magpie.<br />Lands every visual in the nest.</div>
    </div>
  </div>
</body></html>`;
}

const BANNERS = [
  { out: join(README_DIR, "readme-header-1280x320.png"),         w: 1280, h: 320, dark: false, layout: "readme" },
  { out: join(README_DIR, "readme-header-dark-1280x320.png"),    w: 1280, h: 320, dark: true,  layout: "readme" },
  { out: join(README_DIR, "github-social-preview-1280x640.png"), w: 1280, h: 640, dark: false, layout: "social" },
  { out: join(OG_DIR,     "og-image-1200x630.png"),              w: 1200, h: 630, dark: false, layout: "ogcard" },
  { out: join(OG_DIR,     "og-image-dark-1200x630.png"),         w: 1200, h: 630, dark: true,  layout: "ogcard" },
];

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

async function main() {
  const exe = resolveChromePath();
  if (!exe) {
    console.error("Chrome not found. Install Chrome or set MAGPIE_CHROME_PATH.");
    exit(1);
  }
  console.error(`[render-brand-banners] chrome: ${exe}`);

  mkdirSync(README_DIR, { recursive: true });
  mkdirSync(OG_DIR, { recursive: true });
  mkdirSync(UI_PUBLIC_OG, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    for (const b of BANNERS) {
      const page = await browser.newPage();
      await page.setViewport({ width: b.w, height: b.h, deviceScaleFactor: 1 });
      const html = bannerHtml({ width: b.w, height: b.h, dark: b.dark, layout: b.layout });
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
      // Belt-and-braces: extra frame to ensure web-fonts paint.
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 200));
      mkdirSync(dirname(b.out), { recursive: true });
      await page.screenshot({ path: b.out, type: "png", omitBackground: false, clip: { x: 0, y: 0, width: b.w, height: b.h } });
      await page.close();
      console.error(`[render-brand-banners] -> ${b.out.replace(ROOT, ".")}`);
    }
  } finally {
    await browser.close();
  }

  // Mirror the OG card into ui/public/og/ for the dashboard's <meta og:image>.
  const src = join(OG_DIR, "og-image-1200x630.png");
  const dest = join(UI_PUBLIC_OG, "og-image.png");
  const { copyFileSync } = await import("node:fs");
  copyFileSync(src, dest);
  console.error(`[render-brand-banners] mirror -> ${dest.replace(ROOT, ".")}`);

  console.error("[render-brand-banners] done. 5 PNGs re-rendered with Plex 600 + Newsreader italic.");
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
