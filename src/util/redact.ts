import { homedir } from "node:os";
import { sep } from "node:path";

const HOME = homedir();
// Normalize trailing separator so a $HOME prefix match doesn't accidentally
// shadow a sibling path like /home/omeralt/ when HOME = /home/omer.
const HOME_TRAILING = HOME.endsWith(sep) ? HOME : HOME + sep;

/**
 * Replace a leading $HOME prefix with `~/` so logs / error messages don't leak
 * the OS username. v0.9.2 Phase B/A5.
 *
 * - Idempotent — calling twice yields the same string.
 * - Case-insensitive on Windows (where filesystem paths are case-insensitive).
 * - Returns the input unchanged if it doesn't start with $HOME.
 *
 * Use at log-emit sites that include a config-resolved path. Do not use to
 * scrub arbitrary user input — that would over-redact innocent text that
 * happens to start with the username.
 */
export function redactPath(p: string): string {
  if (typeof p !== "string" || p.length === 0) return p;
  const needle = process.platform === "win32" ? HOME_TRAILING.toLowerCase() : HOME_TRAILING;
  const haystack = process.platform === "win32" ? p.toLowerCase() : p;
  if (haystack.startsWith(needle)) {
    return "~" + sep + p.slice(HOME_TRAILING.length);
  }
  // Also catch exact-$HOME (no trailing slash) — `os.homedir()` itself.
  if (haystack === (process.platform === "win32" ? HOME.toLowerCase() : HOME)) {
    return "~";
  }
  return p;
}

/**
 * Redact every $HOME occurrence inside an arbitrary string. Slower than
 * `redactPath` (full substring replace) but safe for free-form log messages
 * that may embed a path mid-string. Useful for error-message scrubbing.
 */
export function redactPathsIn(s: string): string {
  if (typeof s !== "string" || s.length === 0) return s;
  if (process.platform === "win32") {
    // Case-insensitive replace on Windows.
    const lower = s.toLowerCase();
    const homeLower = HOME.toLowerCase();
    let out = "";
    let i = 0;
    while (i < s.length) {
      const idx = lower.indexOf(homeLower, i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx) + "~";
      i = idx + HOME.length;
    }
    return out;
  }
  return s.split(HOME).join("~");
}
