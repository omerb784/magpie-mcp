import { describe, expect, it } from "vitest";
import {
  buildCanonicalRestartError,
  buildCanonicalRestartErrorsFor,
  CANONICAL_RESTART_CODE,
  CANONICAL_RESTART_MESSAGE,
} from "./canonical-restart.js";

describe("buildCanonicalRestartError", () => {
  it("returns a JSON-RPC error frame with code -32099 and retryable=true", () => {
    const frame = buildCanonicalRestartError(42);
    expect(frame.jsonrpc).toBe("2.0");
    expect(frame.id).toBe(42);
    expect(frame.error.code).toBe(CANONICAL_RESTART_CODE);
    expect(frame.error.code).toBe(-32099);
    expect(frame.error.message).toBe(CANONICAL_RESTART_MESSAGE);
    expect(frame.error.data.retryable).toBe(true);
    expect(frame.error.data.reason).toBe("CANONICAL_RESTART");
  });

  it("preserves string ids verbatim", () => {
    const frame = buildCanonicalRestartError("call-abc");
    expect(frame.id).toBe("call-abc");
  });
});

describe("buildCanonicalRestartErrorsFor", () => {
  it("produces one error frame per id, preserving order", () => {
    const frames = buildCanonicalRestartErrorsFor([1, 2, 3]);
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
    for (const f of frames) {
      expect(f.error.code).toBe(-32099);
      expect(f.error.data.retryable).toBe(true);
    }
  });

  it("returns empty array when given empty iterable", () => {
    expect(buildCanonicalRestartErrorsFor(new Set())).toEqual([]);
  });

  it("handles mixed string + number ids", () => {
    const frames = buildCanonicalRestartErrorsFor(["a", 1, "b", 2]);
    expect(frames).toHaveLength(4);
    expect(frames[0]!.id).toBe("a");
    expect(frames[1]!.id).toBe(1);
    expect(frames[2]!.id).toBe("b");
    expect(frames[3]!.id).toBe(2);
  });

  it("each frame is a fresh object (no shared data reference)", () => {
    const frames = buildCanonicalRestartErrorsFor([1, 2]);
    // Mutating one frame's data must not affect the other — guards against an
    // accidental shared-literal regression.
    (frames[0]!.error.data as { retryable: boolean }).retryable = false;
    expect(frames[1]!.error.data.retryable).toBe(true);
  });
});
