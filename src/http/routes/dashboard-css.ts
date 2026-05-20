// Resolves the hashed dashboard CSS asset URL from `dist/ui/index.html`
// so server-rendered chrome surfaces (preview + compare) can include the
// same stylesheet the dashboard uses. The Send-to-Claude island mounts
// the dashboard's React modal into preview/compare — without this link,
// `.send-modal`, `.modal-backdrop`, etc. have no styling.
//
// Resolution is cached after first call. If the dashboard isn't built
// (or the link can't be parsed), returns null and the chrome head
// renders without the link rather than 500ing.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_UI = join(__dirname, "..", "..", "ui");

let cached: string | null | undefined;

export function dashboardCssHref(): string | null {
  if (cached !== undefined) return cached;
  const indexHtml = join(DIST_UI, "index.html");
  if (!existsSync(indexHtml)) {
    cached = null;
    return cached;
  }
  const html = readFileSync(indexHtml, "utf8");
  const m = html.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["']/i);
  cached = m && m[1] ? m[1] : null;
  return cached;
}

export function dashboardCssLinkTag(): string {
  const href = dashboardCssHref();
  return href ? `<link rel="stylesheet" href="${href}">` : "";
}
