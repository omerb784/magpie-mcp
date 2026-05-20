// v0.9.3 Phase G · G4 — talk-with-agent round-trip · NEW (Q1 unlock).
//
// POST /api/inbox → WS inbox.added → MCP read_inbox returns stanza →
// WS inbox.consumed → DB consumed. Undo BEFORE consume = ok; undo AFTER
// consume = "already_consumed" error.
//
// Q1 (2026-05-16) dropped the never-built P6 MCP talk_with_agent tool —
// inbox HTTP path is canonical. This test pins the round-trip.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootPair,
  httpDelete,
  httpPostJson,
  makeHome,
  mcpCall,
  mcpInit,
  openWs,
  parseInboxId,
  parseVisualId,
  shutdownPair,
  type Pair,
  type WsHandle,
} from "./_helpers.js";

let pair: Pair | undefined;
let ws: WsHandle | undefined;
let visualId = "";

beforeAll(async () => {
  pair = await bootPair(makeHome("g4"));
  await mcpInit(pair);

  const add = await mcpCall(pair, "add_visual", {
    project: "g4-twa",
    type: "markdown",
    title: "G4 TWA target",
    content: "# anchor\nfor send\n",
  });
  if (add.isError) throw new Error(`seed failed: ${add.text}`);
  visualId = parseVisualId(add.text);

  ws = await openWs(pair);
}, 120_000);

afterAll(async () => {
  if (ws) await ws.close();
  await shutdownPair(pair);
});

describe("G4 · TWA round-trip", () => {
  it(
    "POST → WS added → MCP read_inbox → WS consumed",
    async () => {
      if (!pair || !ws) throw new Error("setup failed");

      const post = await httpPostJson(pair, "/api/inbox", {
        visual_id: visualId,
        prompt_body: "Please polish the contrast on this mock.",
        vars: { tone: "calm" },
      });
      expect(post.status).toBe(201);
      const inboxId = (post.json as { id?: string }).id;
      expect(typeof inboxId).toBe("string");

      const added = await ws.waitFor(
        (e) => e.kind === "inbox.added" && e.id === inboxId,
        5_000,
      );
      expect(added.kind).toBe("inbox.added");

      const read = await mcpCall(pair, "read_inbox", { count: 5 });
      expect(read.isError).toBe(false);
      expect(read.text).toContain(inboxId);
      expect(read.text).toContain("Please polish the contrast");
      expect(read.text).toContain(`magpie://visual/${visualId}`);
      expect(parseInboxId(read.text)).toBe(inboxId);

      const consumed = await ws.waitFor(
        (e) =>
          e.kind === "inbox.consumed" &&
          Array.isArray((e as { ids?: unknown }).ids) &&
          (e as { ids: string[] }).ids.includes(inboxId!),
        5_000,
      );
      expect(consumed.kind).toBe("inbox.consumed");

      const list = await fetch(`http://127.0.0.1:${pair.httpPort}/api/inbox?status=consumed`, {
        headers: { Host: "127.0.0.1" },
      });
      const listJson = (await list.json()) as { entries: Array<{ id: string; consumed_at: string | null }> };
      const row = listJson.entries.find((e) => e.id === inboxId);
      expect(row).toBeTruthy();
      expect(row!.consumed_at).not.toBeNull();
    },
    45_000,
  );

  it(
    "undo BEFORE consume → deleted ok",
    async () => {
      if (!pair) throw new Error("setup failed");
      const post = await httpPostJson(pair, "/api/inbox", {
        prompt_body: "delete me before consume",
      });
      const inboxId = (post.json as { id?: string }).id!;
      const del = await httpDelete(pair, `/api/inbox/${inboxId}`);
      expect(del.status).toBe(200);
      expect((del.json as { ok?: boolean }).ok).toBe(true);
    },
    20_000,
  );

  it(
    "undo AFTER consume → already_consumed error",
    async () => {
      if (!pair) throw new Error("setup failed");
      const post = await httpPostJson(pair, "/api/inbox", {
        prompt_body: "consume then try delete",
      });
      const inboxId = (post.json as { id?: string }).id!;
      const read = await mcpCall(pair, "read_inbox", { id: inboxId });
      expect(read.isError).toBe(false);
      expect(read.text).toContain(inboxId);

      const del = await httpDelete(pair, `/api/inbox/${inboxId}`);
      expect(del.status).toBe(400);
      expect((del.json as { error?: string }).error).toBe("already_consumed");
    },
    20_000,
  );
});
