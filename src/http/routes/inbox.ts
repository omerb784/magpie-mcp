import type { Hono } from "hono";
import {
  deleteInbox,
  getInbox,
  insertInbox,
  listInbox,
  PROMPT_BODY_MAX,
  type InboxStatus,
} from "../../store/inbox.js";
import { getVisual } from "../../store/visuals.js";
import { notifyResourcesChanged } from "../../mcp/notifications.js";
import { broadcast } from "../ws.js";

interface SendBody {
  visual_id?: unknown;
  template_id?: unknown;
  template_version_num?: unknown;
  prompt_body?: unknown;
  vars?: unknown;
}

function parseVars(raw: unknown): Record<string, string> | null | "bad" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "bad";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return "bad";
    out[k] = v;
  }
  return out;
}

function parseStatus(raw: string | undefined): InboxStatus {
  if (raw === "consumed" || raw === "all") return raw;
  return "pending";
}

export function mountInboxRoutes(app: Hono): void {
  app.get("/api/inbox", (c) => {
    const status = parseStatus(c.req.query("status"));
    return c.json({ entries: listInbox({ status }) });
  });

  app.post("/api/inbox", async (c) => {
    const body = (await c.req.json().catch(() => null)) as SendBody | null;
    if (!body) return c.json({ error: "invalid_json" }, 400);
    if (typeof body.prompt_body !== "string" || body.prompt_body.length === 0) {
      return c.json({ error: "prompt_body_required" }, 400);
    }
    if (body.prompt_body.length > PROMPT_BODY_MAX) {
      return c.json({ error: "prompt_body_too_long", max: PROMPT_BODY_MAX }, 400);
    }
    if (body.visual_id !== undefined && body.visual_id !== null) {
      if (typeof body.visual_id !== "string") {
        return c.json({ error: "visual_id_must_be_string" }, 400);
      }
      if (!getVisual(body.visual_id)) {
        return c.json({ error: "visual_not_found" }, 404);
      }
    }
    if (body.template_id !== undefined && body.template_id !== null) {
      if (typeof body.template_id !== "string") {
        return c.json({ error: "template_id_must_be_string" }, 400);
      }
    }
    let templateVersionNum: number | null = null;
    if (body.template_version_num !== undefined && body.template_version_num !== null) {
      if (typeof body.template_version_num !== "number" || !Number.isInteger(body.template_version_num) || body.template_version_num < 1) {
        return c.json({ error: "template_version_num_must_be_positive_integer" }, 400);
      }
      templateVersionNum = body.template_version_num;
    }
    const vars = parseVars(body.vars);
    if (vars === "bad") {
      return c.json({ error: "vars_must_be_string_record" }, 400);
    }

    const entry = insertInbox({
      visual_id: typeof body.visual_id === "string" ? body.visual_id : null,
      template_id: typeof body.template_id === "string" ? body.template_id : null,
      template_version_num: templateVersionNum,
      prompt_body: body.prompt_body,
      vars,
    });
    notifyResourcesChanged();
    broadcast({ kind: "inbox.added", id: entry.id });
    return c.json(entry, 201);
  });

  app.delete("/api/inbox/:id", (c) => {
    const id = c.req.param("id");
    const existing = getInbox(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.consumed_at) {
      return c.json({ error: "already_consumed" }, 400);
    }
    deleteInbox(id);
    notifyResourcesChanged();
    broadcast({ kind: "inbox.deleted", id });
    return c.json({ ok: true });
  });
}
