// v1.0 — serves the bundled user guide from seed/user-guide/.
//
// `GET /guide`         -> seed/user-guide/guide.html
// `GET /guide/assets/*` -> seed/user-guide/assets/* (PNG screenshots)
//
// The seed/ dir ships in the npm tarball (see package.json "files"). At
// install time it resolves relative to dist/http/routes/ which lives one
// level deeper than dist/, so we walk up three from this module file.

import type { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDE_ROOT = resolve(__dirname, "..", "..", "..", "seed", "user-guide");
const ASSETS_ROOT = join(GUIDE_ROOT, "assets");

function assetContentType(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

export function mountGuideRoutes(app: Hono): void {
  app.get("/guide", (c) => {
    const file = join(GUIDE_ROOT, "guide.html");
    if (!existsSync(file)) {
      return c.text("Guide not bundled.", 404);
    }
    const body = readFileSync(file, "utf8");
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(body);
  });

  app.get("/guide/assets/*", (c) => {
    const url = new URL(c.req.url);
    const rest = decodeURIComponent(url.pathname.replace(/^\/guide\/assets\//, ""));
    if (!rest || rest.includes("..") || rest.startsWith("/") || rest.includes("\\")) {
      return c.text("bad request", 400);
    }
    const target = resolve(ASSETS_ROOT, rest);
    if (!target.startsWith(ASSETS_ROOT) || !existsSync(target) || !statSync(target).isFile()) {
      return c.text("not found", 404);
    }
    const ext = target.split(".").pop() ?? "";
    const buf = readFileSync(target);
    c.header("Content-Type", assetContentType(ext));
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(buf);
  });
}
