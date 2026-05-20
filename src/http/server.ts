import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config, VERSION } from "../config.js";
import { setBaseUrl } from "../runtime.js";
import { originGuard } from "./middleware/origin-guard.js";
import { mountAggregateRoutes } from "./routes/aggregates.js";
import { mountCanonicalInfoRoutes } from "./routes/canonical-info.js";
import { mountGuideRoutes } from "./routes/guide.js";
import { mountInboxRoutes } from "./routes/inbox.js";
import { mountProjectRoutes } from "./routes/projects.js";
import { mountSearchRoutes } from "./routes/search.js";
import { mountSeedRoutes } from "./routes/seed.js";
import { mountSendTemplateRoutes } from "./routes/send-templates.js";
import { mountTemplatesShellRoutes } from "./routes/templates-shell.js";
import { mountVisualRoutes } from "./routes/visuals.js";
import { setupWs } from "./ws.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_UI = join(__dirname, "..", "ui");

const requireFromHere = createRequire(import.meta.url);
const MERMAID_DIR = dirname(requireFromHere.resolve("mermaid/dist/mermaid.esm.min.mjs"));

export interface HttpHandle {
  port: number;
  close(): Promise<void>;
}

export interface StartHttpOptions {
  /** Preferred port — tried once before falling back to the `pickPort` scan
   *  starting from `config.defaultPort`. Used by promoted canonical to keep
   *  the previous canonical's port so open browser tabs survive. */
  preferredPort?: number;
}

export async function startHttpServer(opts: StartHttpOptions = {}): Promise<HttpHandle> {
  const app = new Hono();

  app.use("*", originGuard);

  app.get("/health", (c) =>
    c.json({ ok: true, version: VERSION, home: config.home })
  );

  mountProjectRoutes(app);
  mountVisualRoutes(app);
  mountSearchRoutes(app);
  mountAggregateRoutes(app);
  mountSendTemplateRoutes(app);
  mountTemplatesShellRoutes(app);
  mountInboxRoutes(app);
  mountCanonicalInfoRoutes(app);
  mountGuideRoutes(app);
  mountSeedRoutes(app);

  app.get("/assets/mermaid/*", (c) => {
    const url = new URL(c.req.url);
    const rest = decodeURIComponent(url.pathname.replace(/^\/assets\/mermaid\//, ""));
    if (!rest || rest.includes("..") || rest.startsWith("/") || rest.includes("\\")) {
      return c.text("bad request", 400);
    }
    const target = resolve(MERMAID_DIR, rest);
    if (!target.startsWith(MERMAID_DIR) || !existsSync(target)) {
      return c.text("not found", 404);
    }
    const buf = readFileSync(target);
    const isJs = rest.endsWith(".mjs") || rest.endsWith(".js");
    c.header("Content-Type", isJs ? "application/javascript; charset=utf-8" : "application/octet-stream");
    c.header("Cache-Control", "public, max-age=86400, immutable");
    c.header("Access-Control-Allow-Origin", "*");
    return c.body(buf);
  });

  if (existsSync(DIST_UI)) {
    app.get("/*", async (c, next) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith("/api") || url.pathname === "/ws") return next();
      const candidate = join(
        DIST_UI,
        url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      );
      if (existsSync(candidate)) {
        const { readFileSync } = await import("node:fs");
        const body = readFileSync(candidate);
        const ext = candidate.split(".").pop() ?? "";
        c.header("Content-Type", contentType(ext));
        return c.body(body);
      }
      const fallback = join(DIST_UI, "index.html");
      if (existsSync(fallback)) {
        const { readFileSync } = await import("node:fs");
        return c.html(readFileSync(fallback, "utf8"));
      }
      return c.text("UI not built. Run `npm run build:ui`.", 404);
    });
  } else {
    app.get("/", (c) =>
      c.text("Magpie server up. UI not built — run `npm run build:ui` or use `npm run dev`.")
    );
  }

  const port = await pickPortWithPreferred(opts.preferredPort, config.defaultPort);
  const nodeServer = serve({
    fetch: app.fetch,
    port,
    hostname: config.bind,
  });

  setupWs(nodeServer);
  writeLastPort(port);
  setBaseUrl(`http://${config.bind}:${port}`);

  return {
    port,
    async close() {
      await new Promise<void>((resolve) => nodeServer.close(() => resolve()));
    },
  };
}

async function pickPort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port in ${start}..${start + 100}`);
}

async function isPortFree(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, config.bind);
  });
}

async function pickPortWithPreferred(
  preferred: number | undefined,
  fallbackStart: number,
): Promise<number> {
  if (preferred !== undefined && preferred > 0 && (await isPortFree(preferred))) {
    return preferred;
  }
  return pickPort(fallbackStart);
}

function writeLastPort(port: number): void {
  if (!existsSync(config.home)) mkdirSync(config.home, { recursive: true });
  writeFileSync(config.lastPortFile, String(port), "utf8");
}

function contentType(ext: string): string {
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "application/javascript",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    json: "application/json",
    map: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}
