import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { config } from "../config.js";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

/**
 * Hardened Chrome launch args (v0.9.2 Phase B/S9).
 *
 * Pinned list — DO NOT modify without updating `launch-args.test.ts`.
 *
 * Defense rationale per flag:
 *  - `--disable-dev-shm-usage`: tmpfs `/dev/shm` is often too small in
 *    containers; tells Chrome to use `/tmp`. Functional, no security cost.
 *  - `--disable-gpu`: headless render farm; no GPU available.
 *  - `--hide-scrollbars`: cosmetic; trimmed screenshot edges.
 *  - `--disable-extensions`: no extensions on the isolated profile.
 *  - `--no-first-run`: skip the first-run welcome flow on a fresh profile.
 *  - `--no-default-browser-check`: skip the "make Chrome default" prompt.
 *  - `--disable-background-networking`: no auto-update / safebrowsing / etc.
 *  - `--disable-sync`: never sign in to Google for sync.
 *  - `--metrics-recording-only` + `--disable-breakpad`: no crash reporting.
 *
 * Notably ABSENT (was present pre-S9, removed as a security regression):
 *  - `--no-sandbox`            ← disables Chrome's process sandbox
 *  - `--disable-setuid-sandbox` ← Linux suid-sandbox helper bypass
 *  Magpie renders untrusted HTML supplied by visuals; the sandbox is the
 *  load-bearing OS isolation if a renderer-process RCE is ever found.
 */
export const HARDENED_CHROME_ARGS = Object.freeze([
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--hide-scrollbars",
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-sync",
  "--metrics-recording-only",
  "--disable-breakpad",
] as const);

export function renderProfileDir(): string {
  return join(config.home, ".render-profile");
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
  if (launching) return launching;
  launching = launch();
  try {
    browser = await launching;
    return browser;
  } finally {
    launching = null;
  }
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b && b.connected) {
    try {
      await b.close();
    } catch {
      // ignore
    }
  }
}

// v0.9.3 Phase A — remove stale Chrome singleton files before launch. When
// Chrome dies hard (sleep-wake / OOM / Defender kill) the SingletonLock /
// SingletonCookie / SingletonSocket files survive in the shared userDataDir;
// the next launch fails to acquire the lock and surfaces an unhelpful
// "Failed to launch the browser process! undefined" because puppeteer's
// stderr capture loses the lock-conflict reason. We KNOW Chrome isn't
// running at this call site — either first launch or after closeBrowser()
// cleared the ref — so removing these files is safe and idempotent.
const STALE_SINGLETON_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

export function clearStaleSingletons(userDataDir: string): void {
  for (const name of STALE_SINGLETON_FILES) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // best-effort — caller will retry launch even if cleanup fails.
    }
  }
}

async function launch(): Promise<Browser> {
  const exe = resolveChromePath();
  if (!exe) {
    throw new Error(
      "Chrome not found. Install Chrome or set MAGPIE_CHROME_PATH to its executable."
    );
  }
  const userDataDir = renderProfileDir();
  mkdirSync(userDataDir, { recursive: true });
  clearStaleSingletons(userDataDir);
  try {
    return await puppeteer.launch({
      executablePath: exe,
      headless: true,
      userDataDir,
      args: Array.from(HARDENED_CHROME_ARGS),
    });
  } catch (err) {
    // v0.9.3 Phase A — surface launch context. Puppeteer's default error
    // for a stderr-less spawn fail is "Failed to launch the browser
    // process! undefined" — actionable diagnostics need executablePath +
    // userDataDir so Owner can investigate (wrong Chrome path · stale
    // user-data state · disk permissions). The matcher in render/index.ts
    // still trips on the original puppeteer prefix to drive one retry.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg} [executablePath=${exe}, userDataDir=${userDataDir}]`
    );
  }
}

function resolveChromePath(): string | null {
  if (config.chromePath && existsSync(config.chromePath)) return config.chromePath;
  for (const c of candidates()) {
    if (existsSync(c)) return c;
  }
  return null;
}

function candidates(): string[] {
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
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
