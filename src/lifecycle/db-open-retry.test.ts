import { describe, expect, it, vi } from "vitest";
import { openDbWithRetry } from "./db-open-retry.js";

function makeSqliteError(code: string): Error & { code: string } {
  const err = new Error(`mock sqlite error: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

describe("openDbWithRetry", () => {
  it("returns immediately when open succeeds on first try", async () => {
    const open = vi.fn(() => "db" as const);
    const result = await openDbWithRetry(open);
    expect(result).toBe("db");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("retries on SQLITE_IOERR_TRUNCATE and resolves once open succeeds", async () => {
    let calls = 0;
    const open = vi.fn(() => {
      calls++;
      if (calls < 3) throw makeSqliteError("SQLITE_IOERR_TRUNCATE");
      return "db" as const;
    });
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    const result = await openDbWithRetry(open, { sleep, onRetry });
    expect(result).toBe("db");
    expect(open).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 300);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      code: "SQLITE_IOERR_TRUNCATE",
      delayMs: 100,
    });
    expect(onRetry).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      code: "SQLITE_IOERR_TRUNCATE",
      delayMs: 300,
    });
  });

  it("retries on SQLITE_BUSY / SQLITE_LOCKED / SQLITE_IOERR variants", async () => {
    const codes = ["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_IOERR_READ", "SQLITE_IOERR_WRITE", "SQLITE_IOERR"];
    for (const code of codes) {
      let calls = 0;
      const open = () => {
        calls++;
        if (calls < 2) throw makeSqliteError(code);
        return "db" as const;
      };
      const result = await openDbWithRetry(open, { sleep: async () => undefined });
      expect(result, `expected retry for ${code}`).toBe("db");
    }
  });

  it("throws non-retryable codes on first attempt without sleeping", async () => {
    const open = vi.fn(() => {
      throw makeSqliteError("SQLITE_CORRUPT");
    });
    const sleep = vi.fn(async () => undefined);

    await expect(openDbWithRetry(open, { sleep })).rejects.toMatchObject({
      code: "SQLITE_CORRUPT",
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws errors without a string `code` on first attempt", async () => {
    const open = vi.fn(() => {
      throw new Error("no code on this error");
    });
    const sleep = vi.fn(async () => undefined);

    await expect(openDbWithRetry(open, { sleep })).rejects.toThrow("no code on this error");
    expect(open).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws after 3 retries (4 total attempts) when error persists", async () => {
    const open = vi.fn(() => {
      throw makeSqliteError("SQLITE_BUSY");
    });
    const sleep = vi.fn(async () => undefined);

    await expect(openDbWithRetry(open, { sleep })).rejects.toMatchObject({
      code: "SQLITE_BUSY",
    });
    expect(open).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 300, 800]);
  });

  it("bounded total wait — sum of delays equals 1200ms", async () => {
    const open = vi.fn(() => {
      throw makeSqliteError("SQLITE_BUSY");
    });
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };

    await expect(openDbWithRetry(open, { sleep })).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    const totalMs = sleeps.reduce((a, b) => a + b, 0);
    expect(totalMs).toBe(1200);
  });
});
