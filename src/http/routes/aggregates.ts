import type { Hono } from "hono";
import { ensureTag, listTagAggregates } from "../../store/tags.js";
import { getLibraryCounts } from "../../store/visuals.js";

const TAG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}$/i;

export function mountAggregateRoutes(app: Hono): void {
  app.get("/api/tags", (c) => c.json(listTagAggregates()));
  app.get("/api/library-counts", (c) => c.json(getLibraryCounts()));

  app.post("/api/tags", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body.name !== "string") {
      return c.json({ error: "name_required" }, 400);
    }
    const name = body.name.trim();
    if (!TAG_NAME_RE.test(name)) {
      return c.json({ error: "name_invalid" }, 400);
    }
    const tag = ensureTag(name);
    return c.json(tag, 201);
  });
}
