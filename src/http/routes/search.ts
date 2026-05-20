import type { Hono } from "hono";
import {
  searchVisuals,
  VISUAL_TYPE_VALUES,
  type Source,
  type VisualType,
} from "../../store/visuals.js";
import { CONFIG_SNIPPETS, CONFIG_SNIPPET_CODE, CONFIG_SNIPPET_DESKTOP } from "../../config.js";

const ALLOWED_TYPES = new Set<VisualType>(VISUAL_TYPE_VALUES);
const ALLOWED_SOURCES = new Set<Source>([
  "stitch",
  "figma",
  "mermaid-chart",
  "svgmaker",
  "icons8",
  "claude",
  "manual",
]);

export function mountSearchRoutes(app: Hono): void {
  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? undefined;
    const project = c.req.query("project") ?? undefined;
    const tagsRaw = c.req.queries("tag") ?? [];
    const tags = tagsRaw.filter((t) => typeof t === "string" && t.length > 0);
    const typeRaw = c.req.query("type");
    const type =
      typeRaw && ALLOWED_TYPES.has(typeRaw as VisualType)
        ? (typeRaw as VisualType)
        : undefined;
    const sourceRaw = c.req.query("source");
    if (sourceRaw && !ALLOWED_SOURCES.has(sourceRaw as Source)) {
      return c.json({ error: "bad_source" }, 400);
    }
    const source = sourceRaw ? (sourceRaw as Source) : undefined;
    const starredRaw = c.req.query("starred");
    const starred = starredRaw === "1" || starredRaw === "true" ? true : undefined;
    const rows = searchVisuals({
      query: q,
      project,
      tags: tags.length > 0 ? tags : undefined,
      type,
      source,
      starred,
    });
    return c.json(rows);
  });

  app.get("/api/config-snippet", (c) => {
    const host = c.req.query("host");
    let body: string;
    if (host === "desktop") body = CONFIG_SNIPPET_DESKTOP;
    else if (host === "code") body = CONFIG_SNIPPET_CODE;
    else if (host === "all") body = CONFIG_SNIPPETS;
    else if (host === undefined) body = CONFIG_SNIPPET_CODE;
    else return c.json({ error: "bad_host" }, 400);
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.body(body);
  });
}
