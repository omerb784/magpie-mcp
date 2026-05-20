// v0.9.3 Phase G · G7 — WS reconnect mid-burst.
//
// Pin from v0.9.0 S3. Force-close WS during a render burst · assert client
// reconnects and post-reconnect events flow without server crash.
//
// Current impl has no replay buffer (broadcast is fire-and-forget) — the
// test asserts no-loss semantics for events emitted AFTER reconnect, plus
// server-side resilience to mid-burst disconnects.

import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootPair,
  makeHome,
  mcpCall,
  mcpInit,
  openWs,
  shutdownPair,
  type Pair,
} from "./_helpers.js";

let pair: Pair | undefined;

beforeAll(async () => {
  pair = await bootPair(makeHome("g7"));
  await mcpInit(pair);
}, 120_000);

afterAll(async () => {
  await shutdownPair(pair);
});

describe("G7 · WS reconnect mid-burst", () => {
  it(
    "force-close during render burst → reopen receives subsequent events",
    async () => {
      if (!pair) throw new Error("setup failed");

      const ws1 = await openWs(pair);

      const burst1 = await mcpCall(pair, "add_visual", {
        project: "g7-burst",
        type: "html",
        title: "g7-pre-1",
        content: "<body>pre 1</body>",
      });
      expect(burst1.isError).toBe(false);
      await ws1.waitFor(
        (e) => e.kind === "visual.created" && typeof e.visual_id === "string",
        15_000,
      );

      // Kick off another visual without awaiting, then immediately terminate
      // the socket — server must survive the mid-burst disconnect.
      const inflight = mcpCall(pair, "add_visual", {
        project: "g7-burst",
        type: "html",
        title: "g7-mid",
        content: "<body>mid</body>",
      });
      ws1.socket.terminate();
      await inflight;

      // Reconnect.
      const ws2 = await openWs(pair);
      expect(ws2.socket.readyState).toBe(WebSocket.OPEN);

      // Post-reconnect event MUST flow.
      const post = await mcpCall(pair, "add_visual", {
        project: "g7-burst",
        type: "html",
        title: "g7-post",
        content: "<body>post</body>",
      });
      expect(post.isError).toBe(false);
      const created = await ws2.waitFor(
        (e) => e.kind === "visual.created" && typeof e.visual_id === "string",
        15_000,
      );
      expect(created.kind).toBe("visual.created");

      await ws2.close();

      // Server is still up.
      const health = await fetch(`http://127.0.0.1:${pair.httpPort}/health`, {
        headers: { Host: "127.0.0.1" },
      });
      expect(health.status).toBe(200);
    },
    60_000,
  );

  it(
    "multiple concurrent clients · all see live broadcast",
    async () => {
      if (!pair) throw new Error("setup failed");

      const [a, b, c] = await Promise.all([openWs(pair), openWs(pair), openWs(pair)]);
      try {
        const r = await mcpCall(pair, "add_visual", {
          project: "g7-fanout",
          type: "html",
          title: "fanout",
          content: "<body>fanout</body>",
        });
        expect(r.isError).toBe(false);
        await Promise.all([
          a.waitFor((e) => e.kind === "visual.created", 10_000),
          b.waitFor((e) => e.kind === "visual.created", 10_000),
          c.waitFor((e) => e.kind === "visual.created", 10_000),
        ]);
      } finally {
        await Promise.all([a.close(), b.close(), c.close()]);
      }
    },
    45_000,
  );
});
