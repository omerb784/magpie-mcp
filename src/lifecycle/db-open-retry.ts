// Bounded retry around the first SQLite open on a promoted canonical.
//
// When the canonical process dies hard (SIGKILL, kernel OOM, power loss) on
// Windows, its WAL / -shm file handles can linger for tens to hundreds of
// milliseconds after the process record disappears. A facade racing in via
// the atomic pipe-bind promotion path can win the lock and try to open the
// DB while those handles are still held — better-sqlite3 surfaces this as
// SQLITE_IOERR_TRUNCATE or SQLITE_BUSY at the first `PRAGMA journal_mode = WAL`.
//
// This is bounded: 3 retries at 100ms / 300ms / 800ms = up to 1.2s total wait.
// Non-retryable codes (SQLITE_CORRUPT, etc.) throw on the first attempt.
//
// Carry-in (b) from S4 post-merge smoke diagnosis. See docs/v0.9.0/log.md
// 2026-05-13 post-merge-smoke entry.

const RETRY_DELAYS_MS = [100, 300, 800];

const RETRYABLE_CODES = new Set<string>([
  "SQLITE_BUSY",
  "SQLITE_IOERR",
  "SQLITE_IOERR_TRUNCATE",
  "SQLITE_IOERR_READ",
  "SQLITE_IOERR_WRITE",
  "SQLITE_LOCKED",
]);

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export type OpenDbWithRetryOptions = {
  sleep?: Sleep;
  onRetry?: (info: { attempt: number; code: string; delayMs: number }) => void;
};

export async function openDbWithRetry<T>(
  open: () => T,
  opts: OpenDbWithRetryOptions = {},
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return open();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: unknown }).code;
      if (typeof code !== "string" || !RETRYABLE_CODES.has(code)) throw err;
      if (attempt === RETRY_DELAYS_MS.length) break;
      const delayMs = RETRY_DELAYS_MS[attempt]!;
      opts.onRetry?.({ attempt: attempt + 1, code, delayMs });
      console.error(
        `[magpie] db open ${code} — retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
