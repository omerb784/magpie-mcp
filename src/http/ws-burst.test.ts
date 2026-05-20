import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { broadcast, setupWs, teardownWs } from "./ws.js";

// v0.9.2 Phase J / J4 — WS broadcast burst envelope @ N=50.
//
// Phase H/H4 pinned N=10 single-broadcast p99 < 250 ms + slow-consumer.
// J4 extends to the throughput envelope: N=50 subscribers receiving
// 100 events at 100/s for 10 s. Asserts zero loss, p99 per-event
// latency, peak heap delta. Slow-consumer-at-50 variant.
//
// Per Decision i (Owner walkthrough): report-only. Hard thresholds:
//   - zero events missed across any subscriber (data-loss = major)
//   - p99 per-event latency < 2 s catastrophic floor (>500 ms = minor)
//   - heap delta < 100 MB catastrophic floor (>50 MB = minor)
// Soft thresholds reported via console.error for audit capture.

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
    const timeout = setTimeout(() => reject(new Error("client open timeout")), 5000);
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

interface BurstRecv {
  /** Per-event recv timestamp keyed by event_id. */
  recv: Map<number, number>;
}

function listenForBurst(sock: WebSocket): BurstRecv {
  const r: BurstRecv = { recv: new Map() };
  sock.on("message", (raw) => {
    try {
      const ev = JSON.parse(String(raw));
      if (ev.kind === "visual.updated" && typeof ev.event_id === "number") {
        r.recv.set(ev.event_id, Date.now());
      }
    } catch {
      // ignore
    }
  });
  return r;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.floor(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, idx)]!;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe("J4 · WS broadcast burst envelope", () => {
  let handle: ServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("N=50 receive 100 events @ 100/s over 10s with zero loss", async () => {
    handle = await start();
    const N = 50;
    const TOTAL_EVENTS = 100;
    const INTERVAL_MS = 100;

    const socks: WebSocket[] = [];
    for (let i = 0; i < N; i++) {
      socks.push(await openClient(handle.url, handle.port));
    }
    const recvs = socks.map((s) => listenForBurst(s));

    // Drain mcp.disconnected stragglers before the assertion window.
    await new Promise((r) => setTimeout(r, 100));

    const heapBefore = process.memoryUsage().heapUsed;
    const sendTimes = new Map<number, number>();

    for (let eid = 0; eid < TOTAL_EVENTS; eid++) {
      sendTimes.set(eid, Date.now());
      broadcast({
        kind: "visual.updated",
        visual_id: `j4-burst-${eid}`,
        event_id: eid,
      } as never);
      if (eid < TOTAL_EVENTS - 1) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
    }

    // 2 s grace window for tail events.
    const allReceived = await waitUntil(
      () => recvs.every((r) => r.recv.size === TOTAL_EVENTS),
      2000,
    );

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

    // Counts per subscriber for the audit doc.
    const perSubCounts = recvs.map((r) => r.recv.size);
    const totalLost = perSubCounts.reduce((acc, c) => acc + (TOTAL_EVENTS - c), 0);

    // Aggregate latency across all (sub, event) pairs that arrived.
    const latencies: number[] = [];
    for (const r of recvs) {
      for (const [eid, recvMs] of r.recv) {
        const sent = sendTimes.get(eid);
        if (sent !== undefined) latencies.push(recvMs - sent);
      }
    }
    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 0.5);
    const p99 = percentile(latencies, 0.99);
    const max = latencies[latencies.length - 1] ?? 0;

    // eslint-disable-next-line no-console
    console.error(
      `[J4 burst] N=${N} events=${TOTAL_EVENTS} interval=${INTERVAL_MS}ms · ` +
        `received=${latencies.length}/${N * TOTAL_EVENTS} · lost=${totalLost} · ` +
        `p50=${p50}ms · p99=${p99}ms · max=${max}ms · heap-delta=${heapDeltaMB.toFixed(2)}MB`,
    );

    expect(allReceived, `not all subscribers received all events; counts=${perSubCounts}`).toBe(true);
    expect(totalLost, `lost ${totalLost} events across N*${TOTAL_EVENTS}`).toBe(0);
    expect(p99, `p99 latency ${p99}ms > 2000ms catastrophic floor`).toBeLessThan(2000);
    expect(heapDeltaMB, `heap delta ${heapDeltaMB}MB > 100MB catastrophic floor`).toBeLessThan(100);

    for (const s of socks) s.close();
  }, 30_000);

  it("late-join consumer under burst does not affect the other N-1 subscribers", async () => {
    // Late-join semantics — one sub attaches its message listener 100 ms
    // after the burst starts. Broadcast is fire-and-forget (Phase H/H4
    // signal D); events emitted before the listener attaches are lost to
    // that subscriber per JS EventEmitter contract. The audit-relevant
    // invariant is: the other 49 subs still receive 100/100 within budget,
    // and the late-joiner receives every event broadcast AFTER its
    // listener attached. Reconnect / missed-event replay is v0.9.3+ work
    // per Phase H Decision ii (already-locked carve-out).
    handle = await start();
    const N = 50;
    const TOTAL_EVENTS = 100;
    const INTERVAL_MS = 100;
    const LATE_ATTACH_DELAY_MS = 100;

    const socks: WebSocket[] = [];
    for (let i = 0; i < N; i++) {
      socks.push(await openClient(handle.url, handle.port));
    }

    const slowSock = socks[0]!;
    const slowRecv: BurstRecv = { recv: new Map() };
    let attachedAt = 0;
    setTimeout(() => {
      attachedAt = Date.now();
      slowSock.on("message", (raw) => {
        try {
          const ev = JSON.parse(String(raw));
          if (ev.kind === "visual.updated" && typeof ev.event_id === "number") {
            slowRecv.recv.set(ev.event_id, Date.now());
          }
        } catch {
          // ignore
        }
      });
    }, LATE_ATTACH_DELAY_MS);

    const fastRecvs = socks.slice(1).map((s) => listenForBurst(s));

    await new Promise((r) => setTimeout(r, 20));

    const sendTimes = new Map<number, number>();
    const burstStartedAt = Date.now();
    for (let eid = 0; eid < TOTAL_EVENTS; eid++) {
      sendTimes.set(eid, Date.now());
      broadcast({
        kind: "visual.updated",
        visual_id: `j4-slow-${eid}`,
        event_id: eid,
      } as never);
      if (eid < TOTAL_EVENTS - 1) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
    }

    const fastAllReceived = await waitUntil(
      () => fastRecvs.every((r) => r.recv.size === TOTAL_EVENTS),
      2000,
    );

    const fastLatencies: number[] = [];
    for (const r of fastRecvs) {
      for (const [eid, recvMs] of r.recv) {
        const sent = sendTimes.get(eid);
        if (sent !== undefined) fastLatencies.push(recvMs - sent);
      }
    }
    fastLatencies.sort((a, b) => a - b);
    const fastP99 = percentile(fastLatencies, 0.99);

    // Expected eventual count for the late joiner = events broadcast
    // AFTER attachedAt. Computed from sendTimes.
    let expectedLate = 0;
    for (const sent of sendTimes.values()) {
      if (sent >= attachedAt) expectedLate++;
    }

    // eslint-disable-next-line no-console
    console.error(
      `[J4 late-join] N-1=${N - 1} fastP99=${fastP99}ms · ` +
        `slowCount=${slowRecv.recv.size}/${TOTAL_EVENTS} · ` +
        `expectedLate=${expectedLate} · ` +
        `burstStart-to-attach=${attachedAt - burstStartedAt}ms`,
    );

    expect(fastAllReceived, "fast subscribers did not all receive within budget").toBe(true);
    expect(fastP99, `fast p99 ${fastP99}ms > 2000ms catastrophic floor`).toBeLessThan(2000);
    // Late joiner receives every event broadcast after attach. Allow
    // ±1 grace for boundary-event-id edge cases (event sent at exactly
    // attachedAt may or may not be delivered depending on Node ordering).
    expect(
      Math.abs(slowRecv.recv.size - expectedLate),
      `late-join count ${slowRecv.recv.size} vs expected ${expectedLate}`,
    ).toBeLessThanOrEqual(1);

    for (const s of socks) s.close();
  }, 30_000);
});
