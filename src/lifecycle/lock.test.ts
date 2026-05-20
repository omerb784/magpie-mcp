import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  ipcPathFor,
  lockFilePath,
  publishHttpPort,
  releaseLock,
  type LockResult,
} from "./lock.js";

let home: string;
let acquired: LockResult | null;

beforeEach(() => {
  home = join(tmpdir(), `magpie-lock-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  acquired = null;
});

afterEach(() => {
  if (acquired && acquired.role === "canonical") {
    releaseLock(home, acquired.server);
  }
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("first caller becomes canonical and writes the discovery file", async () => {
    const result = await acquireLock(home);
    acquired = result;

    expect(result.role).toBe("canonical");
    if (result.role !== "canonical") return;

    expect(result.info.pid).toBe(process.pid);
    expect(result.info.ipcPath).toBe(ipcPathFor(home));
    expect(result.server.listening).toBe(true);

    const onDisk = JSON.parse(readFileSync(lockFilePath(home), "utf8"));
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.ipcPath).toBe(ipcPathFor(home));
    expect(typeof onDisk.startedAt).toBe("number");
  });

  it("second caller becomes facade and reads canonical info from discovery", async () => {
    const first = await acquireLock(home);
    acquired = first;
    if (first.role !== "canonical") return;

    const second = await acquireLock(home);
    expect(second.role).toBe("facade");
    if (second.role !== "facade") return;

    expect(second.canonical.pid).toBe(process.pid);
    expect(second.canonical.ipcPath).toBe(first.info.ipcPath);
  });

  it("publishHttpPort updates the discovery file in place", async () => {
    const result = await acquireLock(home, { httpPort: 0 });
    acquired = result;
    if (result.role !== "canonical") return;

    publishHttpPort(home, 48123);

    const onDisk = JSON.parse(readFileSync(lockFilePath(home), "utf8"));
    expect(onDisk.httpPort).toBe(48123);
    // Other fields preserved.
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.ipcPath).toBe(result.info.ipcPath);
  });

  it("releaseLock removes the discovery file and closes the server", async () => {
    const result = await acquireLock(home);
    acquired = result;
    if (result.role !== "canonical") return;

    expect(existsSync(lockFilePath(home))).toBe(true);
    releaseLock(home, result.server);
    acquired = null;
    expect(existsSync(lockFilePath(home))).toBe(false);
  });

  it("MAGPIE_NO_FACADE-equivalent forceCanonical bypasses existing canonical", async () => {
    const first = await acquireLock(home);
    acquired = first;
    if (first.role !== "canonical") return;

    const second = await acquireLock(home, { forceCanonical: true });
    // Second is also canonical because it uses a per-PID ipcPath.
    expect(second.role).toBe("canonical");
    if (second.role !== "canonical") return;
    expect(second.info.ipcPath).not.toBe(first.info.ipcPath);
    expect(second.info.ipcPath).toContain("magpie-");
    releaseLock(home, second.server);
  });

  it("stale discovery file with dead PID is replaced (process.kill detects dead)", async () => {
    // Write a fake discovery file pointing at a clearly-dead PID, but with the
    // matching ipcPath — and DON'T bind the pipe. Caller should bind successfully
    // and overwrite the discovery file with its own info.
    writeFileSync(
      lockFilePath(home),
      JSON.stringify({
        pid: 0x7fffffff, // very unlikely to be a live process
        ipcPath: ipcPathFor(home),
        httpPort: 12345,
        startedAt: Date.now() - 1_000_000,
      }),
    );

    const result = await acquireLock(home);
    acquired = result;
    expect(result.role).toBe("canonical");
    if (result.role !== "canonical") return;
    expect(result.info.pid).toBe(process.pid);
  });
});
