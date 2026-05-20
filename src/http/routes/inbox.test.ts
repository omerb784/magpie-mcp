import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import { type InboxEntry, insertInbox, markConsumed } from "../../store/inbox.js";
import { createProject } from "../../store/projects.js";
import { listTemplates } from "../../store/send-templates.js";
import { createVisual } from "../../store/visuals.js";
import { mountInboxRoutes } from "./inbox.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountInboxRoutes(app);
  return app;
}

async function jsonReq(
  app: Hono,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown
): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.fetch(new Request(`http://localhost${path}`, init));
}

describe("POST /api/inbox", () => {
  it("creates a pending entry (201) for free-form send", async () => {
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", {
      prompt_body: "free-form prompt",
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as InboxEntry;
    expect(entry.id).toBeTruthy();
    expect(entry.visual_id).toBeNull();
    expect(entry.consumed_at).toBeNull();
    expect(entry.prompt_body).toBe("free-form prompt");
  });

  it("creates entry with visual_id + template_id + vars", async () => {
    const project = createProject("alpha", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "Hero",
      type: "html",
      source: null,
    });
    const template = listTemplates()[0];
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", {
      visual_id: visual.id,
      template_id: template.id,
      prompt_body: "iterate",
      vars: { change: "darker" },
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as InboxEntry;
    expect(entry.visual_id).toBe(visual.id);
    expect(entry.template_id).toBe(template.id);
    expect(entry.vars).toEqual({ change: "darker" });
  });

  it("400 when prompt_body missing", async () => {
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("prompt_body_required");
  });

  it("400 when prompt_body over 8000 chars", async () => {
    const big = "x".repeat(8001);
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", { prompt_body: big });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; max: number };
    expect(body.error).toBe("prompt_body_too_long");
    expect(body.max).toBe(8000);
  });

  it("404 when visual_id refers to a missing visual", async () => {
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", {
      visual_id: "vis_missing",
      prompt_body: "x",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("visual_not_found");
  });

  it("400 when vars is not a string record", async () => {
    const res = await jsonReq(buildApp(), "/api/inbox", "POST", {
      prompt_body: "x",
      vars: { num: 42 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("vars_must_be_string_record");
  });
});

describe("GET /api/inbox", () => {
  it("defaults to status=pending", async () => {
    const a = insertInbox({ prompt_body: "a" });
    const b = insertInbox({ prompt_body: "b" });
    markConsumed([a.id]);

    const res = await jsonReq(buildApp(), "/api/inbox", "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: InboxEntry[] };
    expect(body.entries.map((e) => e.id)).toEqual([b.id]);
  });

  it("status=consumed returns consumed lane", async () => {
    const a = insertInbox({ prompt_body: "a" });
    insertInbox({ prompt_body: "b" });
    markConsumed([a.id]);

    const res = await jsonReq(buildApp(), "/api/inbox?status=consumed", "GET");
    const body = (await res.json()) as { entries: InboxEntry[] };
    expect(body.entries.map((e) => e.id)).toEqual([a.id]);
  });

  it("status=all returns both lanes", async () => {
    const a = insertInbox({ prompt_body: "a" });
    insertInbox({ prompt_body: "b" });
    markConsumed([a.id]);

    const res = await jsonReq(buildApp(), "/api/inbox?status=all", "GET");
    const body = (await res.json()) as { entries: InboxEntry[] };
    expect(body.entries).toHaveLength(2);
  });
});

describe("DELETE /api/inbox/:id", () => {
  it("removes pending entry, returns ok", async () => {
    const e = insertInbox({ prompt_body: "x" });
    const res = await jsonReq(buildApp(), `/api/inbox/${e.id}`, "DELETE");
    expect(res.status).toBe(200);
    const list = await jsonReq(buildApp(), "/api/inbox?status=all", "GET");
    const body = (await list.json()) as { entries: InboxEntry[] };
    expect(body.entries).toHaveLength(0);
  });

  it("404 when id missing", async () => {
    const res = await jsonReq(buildApp(), "/api/inbox/nope", "DELETE");
    expect(res.status).toBe(404);
  });

  it("400 when entry already consumed (cannot undo a consumed send)", async () => {
    const e = insertInbox({ prompt_body: "x" });
    markConsumed([e.id]);
    const res = await jsonReq(buildApp(), `/api/inbox/${e.id}`, "DELETE");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_consumed");
  });
});
