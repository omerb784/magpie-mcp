import { describe, expect, it, vi } from "vitest";
import { IpcMcpTransport } from "./ipc-mcp-transport.js";

describe("IpcMcpTransport", () => {
  it("feed() routes inbound frames to onmessage", () => {
    const sent: unknown[] = [];
    const t = new IpcMcpTransport({ send: (m) => sent.push(m) });
    const received: unknown[] = [];
    t.onmessage = (m) => received.push(m);
    t.feed({ jsonrpc: "2.0", id: 1, method: "ping" } as never);
    expect(received).toEqual([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  });

  it("send() invokes the outbound send callback", async () => {
    const sent: unknown[] = [];
    const t = new IpcMcpTransport({ send: (m) => sent.push(m) });
    await t.send({ jsonrpc: "2.0", id: 1, result: { ok: true } } as never);
    expect(sent).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
  });

  it("close() fires onclose and ignores subsequent send/feed", async () => {
    const sent: unknown[] = [];
    const t = new IpcMcpTransport({ send: (m) => sent.push(m) });
    const closeFn = vi.fn();
    t.onclose = closeFn;
    await t.close();
    expect(closeFn).toHaveBeenCalledOnce();
    await t.send({ jsonrpc: "2.0", id: 1, result: {} } as never);
    t.feed({ jsonrpc: "2.0", id: 1, method: "x" } as never);
    expect(sent).toEqual([]); // send dropped post-close
  });

  it("registerClose hook fires onclose when external close trigger fires", () => {
    let fireExt = () => {};
    const t = new IpcMcpTransport({
      send: () => {},
      registerClose: (fire) => {
        fireExt = fire;
      },
    });
    const closeFn = vi.fn();
    t.onclose = closeFn;
    fireExt();
    expect(closeFn).toHaveBeenCalledOnce();
    // Second fire should be a no-op (closed flag set).
    fireExt();
    expect(closeFn).toHaveBeenCalledOnce();
  });
});
