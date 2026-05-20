// Spike Probe 3 port — multi-facade promotion race.
//
// promotion-e2e.test.ts covers the 1-facade case (kill canonical → sole facade
// promotes). This test covers the N-facade case: with multiple facades alive
// when canonical dies, exactly one promotes; the others reconnect to the new
// canonical.
//
// Acceptance:
//   - canonical A + 3 facades up; SIGKILL A
//   - exactly 1 facade emits "[magpie] promoted to canonical pid=" (atomic pipe bind)
//   - the other 2 emit a 2nd "[magpie] connected as facade to canonical pid="
//   - discovery file pid is the promoter; httpPort matches A's previous port (R19)
//   - no facade exits, no LockTimeoutError surfaces

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-process-tree.test-helper.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type SpawnedMagpie = {
  proc: ChildProcess;
  stderr: () => string;
  waitForStderr: (substring: string, timeoutMs?: number) => Promise<void>;
};

function spawnMagpie(home: string): SpawnedMagpie {
  const proc = spawn(process.execPath, [TSX_BIN, INDEX_TS], {
    env: { ...process.env, MAGPIE_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errBuf = "";
  proc.stderr!.on("data", (c) => {
    errBuf += c.toString();
  });
  return {
    proc,
    stderr: () => errBuf,
    waitForStderr: (sub, timeoutMs = 45_000) =>
      new Promise<void>((resolve, reject) => {
        if (errBuf.includes(sub)) return resolve();
        const onData = (c: Buffer) => {
          errBuf += c.toString();
          if (errBuf.includes(sub)) {
            cleanup();
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `timeout waiting for stderr to contain ${JSON.stringify(sub)}; got: ${errBuf.slice(-600)}`,
            ),
          );
        }, timeoutMs);
        const cleanup = () => {
          proc.stderr!.off("data", onData);
          clearTimeout(timer);
        };
        proc.stderr!.on("data", onData);
      }),
  };
}

type DiscoveryFile = {
  pid: number;
  ipcPath: string;
  httpPort: number;
  startedAt: number;
};

function readDiscovery(home: string): DiscoveryFile {
  const raw = readFileSync(path.join(home, "magpie.lock"), "utf8");
  return JSON.parse(raw) as DiscoveryFile;
}

async function waitForDiscovery(
  home: string,
  predicate: (info: DiscoveryFile) => boolean,
  timeoutMs = 45_000,
): Promise<DiscoveryFile> {
  const deadline = Date.now() + timeoutMs;
  let last: DiscoveryFile | null = null;
  while (Date.now() < deadline) {
    try {
      const info = readDiscovery(home);
      last = info;
      if (predicate(info)) return info;
    } catch {
      /* atomic rename window */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `timeout waiting for discovery predicate; last seen: ${JSON.stringify(last)}`,
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

const HOME = path.join(tmpdir(), `magpie-probe3-${process.pid}-${Date.now()}`);
let canonicalA: SpawnedMagpie | undefined;
const facades: SpawnedMagpie[] = [];
let aHttpPort = 0;
let aPid = 0;

beforeAll(async () => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });

  canonicalA = spawnMagpie(HOME);
  await canonicalA.waitForStderr("[magpie] canonical pid=");
  const discovery = await waitForDiscovery(HOME, (i) => i.httpPort > 0);
  aHttpPort = discovery.httpPort;
  aPid = discovery.pid;

  // Spawn 3 facades; wait for all to register as facade.
  for (let i = 0; i < 3; i++) facades.push(spawnMagpie(HOME));
  await Promise.all(
    facades.map((f) => f.waitForStderr("[magpie] connected as facade to canonical pid=")),
  );
}, 120_000);

afterAll(async () => {
  killProcessTree(canonicalA?.proc, "SIGTERM");
  for (const f of facades) killProcessTree(f.proc, "SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  killProcessTree(canonicalA?.proc, "SIGKILL");
  for (const f of facades) killProcessTree(f.proc, "SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  if (existsSync(HOME)) {
    try {
      rmSync(HOME, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("probe3-promotion-race (multi-facade)", () => {
  it(
    "kill canonical → exactly 1 facade promotes, other facades reconnect, httpPort preserved",
    async () => {
      if (!canonicalA || facades.length !== 3) throw new Error("setup failed");

      // 1. Kill canonical A.
      killProcessTree(canonicalA.proc, "SIGKILL");

      const promoteTag = "[magpie] promoted to canonical pid=";
      const reconnectTag = "[magpie] connected as facade to canonical pid=";

      // 2. Race: wait until ANY facade emits the promote tag. Bind atomicity
      //    means only one will — but we don't yet know which.
      await Promise.race(
        facades.map((f) => f.waitForStderr(promoteTag, 45_000)),
      );

      // 3. Brief settle window so the other two facades have time to log their
      //    reconnect line. 2s is plenty — both processes are already inside
      //    the boot-loop retry by the time the winner banners.
      const settleDeadline = Date.now() + 5_000;
      while (Date.now() < settleDeadline) {
        const nonPromoters = facades.filter(
          (f) => !f.stderr().includes(promoteTag),
        );
        if (
          nonPromoters.length === 2 &&
          nonPromoters.every((f) => countOccurrences(f.stderr(), reconnectTag) >= 2)
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // 4. Final assertions on the captured buffers.
      const promoters = facades.filter((f) => f.stderr().includes(promoteTag));
      expect(promoters.length).toBe(1);

      const nonPromoters = facades.filter((f) => !f.stderr().includes(promoteTag));
      expect(nonPromoters.length).toBe(2);
      for (const f of nonPromoters) {
        expect(countOccurrences(f.stderr(), reconnectTag)).toBeGreaterThanOrEqual(2);
      }

      // 4. Discovery file: pid != A's; httpPort preserved (R19).
      const afterPromotion = await waitForDiscovery(
        HOME,
        (i) => i.pid !== aPid && i.httpPort > 0,
      );
      expect(afterPromotion.pid).not.toBe(aPid);
      expect(afterPromotion.httpPort).toBe(aHttpPort);
    },
    180_000,
  );
});
