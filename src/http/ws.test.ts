import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetMcpStateForTest,
  isMcpConnected,
  onMcpStateChange,
  setMcpConnected,
} from "./mcp-state.js";

beforeEach(() => {
  _resetMcpStateForTest();
});

describe("mcp connection state", () => {
  it("starts disconnected", () => {
    expect(isMcpConnected()).toBe(false);
  });

  it("setMcpConnected(true) flips state and notifies listeners", () => {
    const events: boolean[] = [];
    onMcpStateChange((c) => events.push(c));
    setMcpConnected(true);
    expect(isMcpConnected()).toBe(true);
    expect(events).toEqual([true]);
  });

  it("setMcpConnected(false) after true emits disconnect", () => {
    const events: boolean[] = [];
    onMcpStateChange((c) => events.push(c));
    setMcpConnected(true);
    setMcpConnected(false);
    expect(events).toEqual([true, false]);
    expect(isMcpConnected()).toBe(false);
  });

  it("does not emit on no-op transition", () => {
    const events: boolean[] = [];
    onMcpStateChange((c) => events.push(c));
    setMcpConnected(false);
    setMcpConnected(true);
    setMcpConnected(true);
    setMcpConnected(true);
    expect(events).toEqual([true]);
  });

  it("listener can unsubscribe", () => {
    const events: boolean[] = [];
    const off = onMcpStateChange((c) => events.push(c));
    setMcpConnected(true);
    off();
    setMcpConnected(false);
    expect(events).toEqual([true]);
  });

  it("multiple listeners all receive transitions", () => {
    const a: boolean[] = [];
    const b: boolean[] = [];
    onMcpStateChange((c) => a.push(c));
    onMcpStateChange((c) => b.push(c));
    setMcpConnected(true);
    setMcpConnected(false);
    expect(a).toEqual([true, false]);
    expect(b).toEqual([true, false]);
  });
});
