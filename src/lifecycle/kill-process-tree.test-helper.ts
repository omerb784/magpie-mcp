// Test-only helper: kill a spawned child process and its descendants.
//
// On Windows our test harness spawns `node tsx-cli.mjs src/index.ts` — a
// 2-level process tree. `proc.kill('SIGKILL')` only signals the outer tsx
// wrapper; the grandchild Node holding the SQLite WAL/-shm + IPC pipe handles
// can live on for ~100-500ms until Windows notices the parent gone. Promoted
// canonicals racing into the DB inside that window get SQLITE_IOERR_TRUNCATE.
//
// `taskkill /T /F /PID <pid>` kills the whole tree synchronously. /T = include
// child tree. /F = force (matches SIGKILL semantics — no graceful TERM cycle).
//
// On POSIX, killing the direct child reaps its descendants via the process
// group (we don't pass `detached: true`), so `proc.kill(signal)` is enough.
//
// Carried in from S4 post-merge e2e flake on main — see docs/v0.9.0/log.md
// 2026-05-13 post-merge-smoke entry.

import { spawnSync, type ChildProcess } from "node:child_process";

export function killProcessTree(
  proc: ChildProcess | undefined,
  signal: NodeJS.Signals = "SIGKILL",
): void {
  if (!proc) return;
  const pid = proc.pid;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
    } catch {
      /* best-effort — process may already be gone */
    }
    return;
  }

  if (proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill(signal);
  } catch {
    /* best-effort — process may already be gone */
  }
}
