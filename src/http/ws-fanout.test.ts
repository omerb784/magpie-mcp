import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { broadcast, setupWs, teardownWs } from "./ws.js";

interface ServerHandle {
  server: Server;
  url: string;
  port: number;
  close: () => Promise<void>;
}

function start(): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const server = createServer();
    setupWs(server);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        url: `ws://127.0.0.1:${port}/ws`,
        port,
        close: () =>
          new Promise<void>((done) => {
            teardownWs();
            server.close(() => done());
          }),
      });
    });
  });
}

function openClient(url: string, port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } });
    const timeout = setTimeout(() => reject(new Error("client open timeout")), 2000);
    sock.once("open", () => {
      clearTimeout(timeout);
      resolve(sock);
    });
    sock.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

interface Recv {
  visualUpdatedAt: number | null;
}

function listenForVisualUpdated(sock: WebSocket, marker: string): Recv {
  const recv: Recv = { visualUpdatedAt: null };
  sock.on("message", (raw) => {
    try {
      const ev = JSON.parse(String(raw));
      if (ev.kind === "visual.updated" && ev.visual_id === marker) {
        recv.visualUpdatedAt = Date.now();
      }
    } catch {
      // ignore non-JSON
    }
  });
  return recv;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe("H4 · WS broadcast fan-out", () => {
  let handle: ServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("N=10 subscribers all receive a broadcast within 250 ms p99", async () => {
    handle = await start();
    const N = 10;
    const socks: WebSocket[] = [];
    for (let i = 0; i < N; i++) {
      socks.push(await openClient(handle.url, handle.port));
    }

    const marker = "h4-fanout-fake";
    const recvs = socks.map((s) => listenForVisualUpdated(s, marker));

    // Give the initial `mcp.disconnected` events time to land + flush so
    // they don't interleave with the assertion window.
    await new Promise((r) => setTimeout(r, 50));

    const t0 = Date.now();
    broadcast({ kind: "visual.updated", visual_id: marker });

    const allReceived = await waitUntil(
      () => recvs.every((r) => r.visualUpdatedAt !== null),
      1000,
    );
    expect(allReceived, "not every subscriber received the broadcast").toBe(true);

    const latencies = recvs.map((r) => (r.visualUpdatedAt ?? 0) - t0).sort((a, b) => a - b);
    // p99 on N=10 = the max. Soft ceiling 250 ms.
    const p99 = latencies[latencies.length - 1];
    // eslint-disable-next-line no-console
    console.error(`[H4 fan-out] N=${N} latencies(ms)=${JSON.stringify(latencies)} p99=${p99}`);
    expect(p99, `p99 ${p99} ms exceeded 250 ms budget`).toBeLessThan(250);

    for (const s of socks) s.close();
  }, 30_000);

  it("slow-consumer in the set does not delay the other N-1 subscribers", async () => {
    // The WS server's `broadcast()` iterates `wss.clients` and calls
    // `client.send(payload)` synchronously. `send()` returns immediately on
    // `WebSocket.OPEN` — the OS socket buffer absorbs the lag. So a slow
    // consumer should never delay the fan-out to the others. This test
    // pins that invariant.
    handle = await start();
    const N = 10;
    const socks: WebSocket[] = [];
    for (let i = 0; i < N; i++) {
      socks.push(await openClient(handle.url, handle.port));
    }

    const marker = "h4-slow-fake";

    // The "slow" client: don't attach the message listener until after a
    // 100 ms delay. The send still lands on the kernel socket buffer; the
    // listener catches up once attached.
    const slowSock = socks[0]!;
    const slowRecv: Recv = { visualUpdatedAt: null };
    setTimeout(() => {
      slowSock.on("message", (raw) => {
        try {
          const ev = JSON.parse(String(raw));
          if (ev.kind === "visual.updated" && ev.visual_id === marker) {
            slowRecv.visualUpdatedAt = Date.now();
          }
        } catch {
          // ignore
        }
      });
    }, 100);

    const fastRecvs = socks.slice(1).map((s) => listenForVisualUpdated(s, marker));

    await new Promise((r) => setTimeout(r, 50));

    const t0 = Date.now();
    broadcast({ kind: "visual.updated", visual_id: marker });

    const fastAllReceived = await waitUntil(
      () => fastRecvs.every((r) => r.visualUpdatedAt !== null),
      1000,
    );
    expect(fastAllReceived, "fast subscribers did not all receive within budget").toBe(true);

    const fastLatencies = fastRecvs.map((r) => (r.visualUpdatedAt ?? 0) - t0).sort((a, b) => a - b);
    const fastP99 = fastLatencies[fastLatencies.length - 1];
    // eslint-disable-next-line no-console
    console.error(
      `[H4 slow-consumer] fast N=${N - 1} fastLatencies=${JSON.stringify(fastLatencies)} fastP99=${fastP99}`,
    );
    expect(fastP99, `fast p99 ${fastP99} ms exceeded 250 ms budget`).toBeLessThan(250);

    for (const s of socks) s.close();
  }, 30_000);
});
