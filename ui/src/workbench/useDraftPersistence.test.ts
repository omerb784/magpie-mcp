import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_MAX_BYTES,
  DRAFT_PREFIX,
  clearDraft,
  readDraft,
} from "./useDraftPersistence";

// Minimal localStorage shim so the helpers work in jsdom-less envs too.
class MemStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage: MemStorage }).localStorage = new MemStorage();
  (globalThis as { window: { localStorage: MemStorage } }).window = {
    localStorage: (globalThis as { localStorage: MemStorage }).localStorage,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("draft persistence helpers", () => {
  it("readDraft returns null when key is missing", () => {
    expect(readDraft("v01", "iterate")).toBeNull();
  });

  it("readDraft parses a valid record", () => {
    const key = `${DRAFT_PREFIX}v01.iterate`;
    (window as unknown as { localStorage: MemStorage }).localStorage.setItem(
      key,
      JSON.stringify({
        varValues: { change: "hello" },
        examples: [],
        savedAt: 123,
      }),
    );
    const r = readDraft("v01", "iterate");
    expect(r).not.toBeNull();
    expect(r?.varValues.change).toBe("hello");
    expect(r?.savedAt).toBe(123);
  });

  it("readDraft returns null when JSON is malformed", () => {
    const key = `${DRAFT_PREFIX}v01.iterate`;
    (window as unknown as { localStorage: MemStorage }).localStorage.setItem(
      key,
      "{not json",
    );
    expect(readDraft("v01", "iterate")).toBeNull();
  });

  it("clearDraft removes the key", () => {
    const key = `${DRAFT_PREFIX}v01.iterate`;
    (window as unknown as { localStorage: MemStorage }).localStorage.setItem(
      key,
      JSON.stringify({ varValues: {}, examples: [], savedAt: 1 }),
    );
    clearDraft("v01", "iterate");
    expect(readDraft("v01", "iterate")).toBeNull();
  });

  it("DRAFT_MAX_BYTES is 50KB", () => {
    expect(DRAFT_MAX_BYTES).toBe(50 * 1024);
  });
});
