// Pipe-as-lock primitive for Path 2 lifecycle (R19).
//
// The IPC server's named-pipe / unix-domain-socket bind IS the canonical-singleton
// lock — atomic across processes via OS-level EADDRINUSE. The discovery file at
// $MAGPIE_HOME/magpie.lock is written *after* successful bind and exists only so
// facades can find the canonical's pid + ipcPath + httpPort. Same pattern PostgreSQL
// and similar daemons use.
//
// Spike-validated: see spike/README.md on branch spike/lifecycle-path2 commit 45b0f7f.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export type CanonicalInfo = {
  pid: number;
  ipcPath: string;
  httpPort: number;
  startedAt: number;
};

export type LockResult =
  | {
      role: "canonical";
      info: CanonicalInfo;
      server: net.Server;
      /** When a stale `magpie.lock` was present at bind time, the previous
       *  canonical's httpPort is forwarded here so callers (HTTP server) can
       *  try to re-bind the same port — preserves open browser tabs on
       *  promotion. Undefined on fresh boots. */
      previousHttpPort?: number;
    }
  | { role: "facade"; canonical: CanonicalInfo };

export class LockCorruptError extends Error {
  override readonly name = "LockCorruptError";
}

export class LockTimeoutError extends Error {
  override readonly name = "LockTimeoutError";
}

const DISCOVERY_POLL_MAX_MS = 2_000;
const DISCOVERY_POLL_INTERVAL_MS = 25;

export function ipcPathFor(home: string): string {
  const hash = crypto.createHash("sha1").update(path.resolve(home)).digest("hex").slice(0, 12);
  if (process.platform === "win32") return `\\\\.\\pipe\\magpie-${hash}`;
  return path.join(os.tmpdir(), `magpie-${hash}.sock`);
}

export function lockFilePath(home: string): string {
  return path.join(home, "magpie.lock");
}

function readDiscovery(file: string): CanonicalInfo | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as Partial<CanonicalInfo>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.ipcPath !== "string" ||
      typeof parsed.httpPort !== "number"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      ipcPath: parsed.ipcPath,
      httpPort: parsed.httpPort,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeDiscoveryAtomic(file: string, info: CanonicalInfo): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
  fs.renameSync(tmp, file);
}

function unlinkIfExists(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/**
 * Restrict the IPC pipe / socket to the current user only (v0.9.2 Phase B/S8).
 *
 * - Unix: Node's default socket-file mode is `0o777 & ~umask`. With the
 *   typical umask `0o022`, that's `0o755` — readable + connectable by any
 *   local user. Chmod to `0o600` so only the creating user can connect.
 * - Windows: Named pipes default to a security descriptor inherited from the
 *   creating process token, which on a non-elevated session restricts to
 *   the creator + SYSTEM + Admins. Node 22.6.0+ adds an explicit
 *   `pipeDacl: 'user-only'` listen option — we don't pass it here because
 *   our floor is Node 20; revisit when the floor moves.
 */
function hardenIpcPermissions(ipcPath: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(ipcPath, 0o600);
  } catch {
    /* the listen succeeded; failure to chmod is best-effort */
  }
}

function tryBindPipe(ipcPath: string): Promise<net.Server | null> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      // Stale socket files survive process death on unix — clean defensively.
      // If a live canonical owns it, the subsequent listen() race is resolved
      // by net's own EADDRINUSE handling.
      unlinkIfExists(ipcPath);
    }
    const server = net.createServer();
    let settled = false;
    const done = (value: net.Server | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        done(null);
        return;
      }
      // Any other bind error — treat as facade-fail-safe and let caller retry.
      done(null);
    });
    server.once("listening", () => {
      hardenIpcPermissions(ipcPath);
      done(server);
    });
    server.listen(ipcPath);
  });
}

export type AcquireOptions = {
  /** Default port the canonical will publish in the discovery file. The HTTP
   *  server itself decides actual port; this is just what gets written to disk
   *  so facades and dashboard reconnect-pollers can find it. */
  httpPort?: number;
  /** Debug aid (MAGPIE_NO_FACADE=1): derive a per-PID ipcPath + discovery file
   *  so the process always boots as canonical, never sees a shared lock.
   *  Two canonicals can race on the shared SQLite database — use only when
   *  intentionally bypassing the lifecycle for diagnostics. */
  forceCanonical?: boolean;
};

/**
 * Acquire canonical role by binding the IPC pipe.
 *
 * Returns immediately with `role: 'canonical'` if bind succeeded (caller MUST
 * keep the returned `net.Server` and pass it to startIpcServer to accept facade
 * connections). Returns `role: 'facade'` with the existing canonical's info if
 * bind failed and a valid discovery file points at a live canonical.
 *
 * Throws LockTimeoutError if discovery file never appears within the poll window
 * — indicates a half-booted canonical that won the pipe race but crashed before
 * writing discovery.
 */
export async function acquireLock(
  home: string,
  options: AcquireOptions = {},
): Promise<LockResult> {
  const effectiveHome = options.forceCanonical ? `${home}::debug-${process.pid}` : home;
  const ipcPath = ipcPathFor(effectiveHome);
  const file = lockFilePath(home);

  // Capture previous canonical's httpPort BEFORE we overwrite the discovery
  // file. Used by promoted canonical to attempt port-recovery (R19 browser
  // URL stability clause).
  const stalePrevious = readDiscovery(file);
  const previousHttpPort =
    stalePrevious && typeof stalePrevious.httpPort === "number" && stalePrevious.httpPort > 0
      ? stalePrevious.httpPort
      : undefined;

  // Try to be canonical.
  const server = await tryBindPipe(ipcPath);
  if (server) {
    const info: CanonicalInfo = {
      pid: process.pid,
      ipcPath,
      httpPort: options.httpPort ?? 0,
      startedAt: Date.now(),
    };
    writeDiscoveryAtomic(file, info);
    return previousHttpPort !== undefined
      ? { role: "canonical", info, server, previousHttpPort }
      : { role: "canonical", info, server };
  }

  // Couldn't bind — find the canonical via discovery file.
  const deadline = Date.now() + DISCOVERY_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const existing = readDiscovery(file);
    if (existing && existing.ipcPath === ipcPath) {
      return { role: "facade", canonical: existing };
    }
    await new Promise((r) => setTimeout(r, DISCOVERY_POLL_INTERVAL_MS));
  }

  // Pipe is bound by someone but discovery never appeared. Could be a crashed
  // canonical between bind+write, or the holder isn't a Magpie process.
  // Surface as facade with a synthesized canonical record so the caller can
  // decide whether to retry, force MAGPIE_NO_FACADE, or fail.
  throw new LockTimeoutError(
    `IPC pipe at ${ipcPath} is bound but no valid discovery file at ${file} after ${DISCOVERY_POLL_MAX_MS}ms`,
  );
}

/** Release canonical state — unlink discovery file + close IPC server.
 *  Called from canonical's shutdown handlers. */
export function releaseLock(home: string, server?: net.Server): void {
  unlinkIfExists(lockFilePath(home));
  try {
    server?.close();
  } catch {
    /* ignore */
  }
}

/** Read the current discovery file. Returns `null` if missing or corrupt.
 *  Backs the `/api/canonical-info` endpoint — the dashboard polls this after a
 *  WS disconnect to detect canonical identity changes after promotion. */
export function readCanonicalInfo(home: string): CanonicalInfo | null {
  return readDiscovery(lockFilePath(home));
}

/** Update the discovery file with a corrected HTTP port. Canonical calls this
 *  after the HTTP server has actually bound a port (which it picks dynamically). */
export function publishHttpPort(home: string, httpPort: number): void {
  const file = lockFilePath(home);
  const existing = readDiscovery(file);
  if (!existing) {
    throw new LockCorruptError(`cannot update httpPort: discovery file missing at ${file}`);
  }
  writeDiscoveryAtomic(file, { ...existing, httpPort });
}
