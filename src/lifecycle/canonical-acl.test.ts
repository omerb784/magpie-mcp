import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock, type LockResult } from "./lock.js";

let home: string;
let acquired: LockResult | null;

beforeEach(() => {
  home = join(
    tmpdir(),
    `magpie-acl-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
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

describe("S8 · IPC pipe/socket ACL · user-only access", () => {
  it("unix socket file mode is 0o600 after canonical listen (no group/other access)", async () => {
    if (process.platform === "win32") return; // Windows path covered in the next test.
    const result = await acquireLock(home);
    acquired = result;
    expect(result.role).toBe("canonical");
    if (result.role !== "canonical") return;

    const ipcPath = result.info.ipcPath;
    expect(existsSync(ipcPath)).toBe(true);

    const s = statSync(ipcPath);
    // Mask off file-type bits — keep only permission bits.
    const perms = s.mode & 0o777;
    expect(perms).toBe(0o600);

    // Belt-and-suspenders: group + other bits explicitly zero.
    expect(perms & 0o077).toBe(0);
    // Owner bits at least RW.
    expect(perms & 0o600).toBe(0o600);
  });

  it("windows named pipe path lives under \\\\.\\pipe\\magpie-* (system-scoped namespace, default DACL = creator + admins)", async () => {
    if (process.platform !== "win32") return; // Unix path covered above.
    const result = await acquireLock(home);
    acquired = result;
    expect(result.role).toBe("canonical");
    if (result.role !== "canonical") return;

    // Per Node + Windows docs, named pipes created without an explicit
    // SECURITY_DESCRIPTOR inherit the creator process's primary token DACL.
    // For a non-elevated user session the default grants only the creator
    // (plus SYSTEM and Administrators by default) — not Everyone. We verify
    // the namespace prefix here; the runtime DACL assertion would require
    // a native Win32 call (not part of Node's stdlib). Logged in audit doc.
    expect(result.info.ipcPath.toLowerCase().startsWith("\\\\.\\pipe\\magpie-")).toBe(true);
  });

  it("ipc path is deterministic per-home (hashed home dir, no PID in default mode)", async () => {
    const a = await acquireLock(home);
    acquired = a;
    expect(a.role).toBe("canonical");
    if (a.role !== "canonical") return;

    // Same home → same ipcPath (no per-call randomness leaking into the path).
    const { ipcPathFor } = await import("./lock.js");
    expect(ipcPathFor(home)).toBe(a.info.ipcPath);
  });
});
