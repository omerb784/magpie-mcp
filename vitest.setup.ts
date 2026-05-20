import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_HOME = join(tmpdir(), `magpie-test-${process.pid}`);

process.env.MAGPIE_HOME = TEST_HOME;
process.env.MAGPIE_BIND ??= "127.0.0.1";

// v0.9.3 Phase J prep — vitest parallel workers all called startHttpServer()
// with the same default port (3737) and races on the pickPort TOCTOU window
// produced EADDRINUSE flakes in browser-restart + per-format-bench when two
// suites set up at the same instant. Give each worker a unique port range so
// the scan starts well clear of every other worker's window.
//
// pickPort scans 100 ports up from the start. (process.pid % 50) * 200 gives
// each PID a 200-port lane in [3737, 13737] - 50 lanes, never overlap with
// the 100-port pickPort window. PID uniqueness within a vitest run is
// guaranteed by the OS while the workers are alive.
if (!process.env.MAGPIE_PORT) {
  const lane = process.pid % 50;
  process.env.MAGPIE_PORT = String(3737 + lane * 200);
}

if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(TEST_HOME, { recursive: true });
