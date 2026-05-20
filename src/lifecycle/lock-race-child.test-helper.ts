// Helper spawned by lock-race.test.ts to race against siblings on acquireLock.
// Standalone — does NOT import from vitest. Run via:
//   node --experimental-strip-types --no-warnings lock-race-child.ts <home>
//
// Emits a single line of JSON to stdout: {"role": "canonical"|"facade", "pid": <n>}.
// Stays alive ~500ms after acquiring so siblings can observe its discovery file.

import { acquireLock, releaseLock } from "./lock.ts";

const home = process.argv[2];
if (!home) {
  process.stderr.write("missing home arg\n");
  process.exit(2);
}

const result = await acquireLock(home);
const payload =
  result.role === "canonical"
    ? { role: "canonical", pid: process.pid, ipcPath: result.info.ipcPath }
    : { role: "facade", pid: process.pid, canonicalPid: result.canonical.pid };
process.stdout.write(JSON.stringify(payload) + "\n");

if (result.role === "canonical") {
  setTimeout(() => {
    releaseLock(home, result.server);
    process.exit(0);
  }, 500);
} else {
  process.exit(0);
}
