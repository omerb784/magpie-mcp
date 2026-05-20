// End-to-end: spawn canonical A + facade B, kill A, assert B promotes and
// re-binds the previous HTTP port (R19 browser-URL stability). Then spawn a
// fresh facade C and verify it can talk to B as the new canonical.
//
// Real child processes via `tsx` against src/index.ts — no build step.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-process-tree.test-helper.js";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""),
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
    waitForStderr: (sub, timeoutMs = 45000) =>
      new Promise<void>((resolve, reject) => {
        if (errBuf.includes(sub)) return resolve();
        const onData = (c: Buffer) => {
          if ((errBuf + c.toString()).includes(sub)) {
            cleanup();
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `timeout waiting for stderr to contain ${JSON.stringify(sub)}; got: ${errBuf.slice(-800)}`,
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

async function waitForDiscoveryHttpPort(
  home: string,
  predicate: (info: DiscoveryFile) => boolean,
  timeoutMs = 30_000,
): Promise<DiscoveryFile> {
  const deadline = Date.now() + timeoutMs;
  let last: DiscoveryFile | null = null;
  while (Date.now() < deadline) {
    try {
      const info = readDiscovery(home);
      last = info;
      if (predicate(info)) return info;
    } catch {
      /* file may briefly not exist during atomic rename */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `timeout waiting for discovery predicate; last seen: ${JSON.stringify(last)}`,
  );
}

const HOME = path.join(tmpdir(), `magpie-promotion-${process.pid}-${Date.now()}`);
let canonicalA: SpawnedMagpie | undefined;
let facadeB: SpawnedMagpie | undefined;
let aHttpPort = 0;
let aPid = 0;

beforeAll(async () => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });

  canonicalA = spawnMagpie(HOME);
  await canonicalA.waitForStderr("[magpie] canonical pid=");
  // The discovery file is written BEFORE the HTTP port is known; publishHttpPort
  // updates it after the HTTP server binds. Poll until httpPort > 0.
  const discovery = await waitForDiscoveryHttpPort(HOME, (i) => i.httpPort > 0);
  aHttpPort = discovery.httpPort;
  aPid = discovery.pid;

  facadeB = spawnMagpie(HOME);
  await facadeB.waitForStderr("[magpie] connected as facade");
}, 120_000);

afterAll(async () => {
  killProcessTree(canonicalA?.proc, "SIGTERM");
  killProcessTree(facadeB?.proc, "SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  killProcessTree(canonicalA?.proc, "SIGKILL");
  killProcessTree(facadeB?.proc, "SIGKILL");
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("canonical promotion (cross-process)", () => {
  it(
    "kill canonical → facade promotes, binds previous HTTP port, fresh facade connects to new canonical",
    async () => {
      if (!canonicalA || !facadeB) throw new Error("setup failed");

      // 1. Kill canonical A.
      killProcessTree(canonicalA.proc, "SIGKILL");

      // 2. Facade B should promote — its stderr prints "promoted to canonical".
      await facadeB.waitForStderr("[magpie] promoted to canonical pid=", 45_000);
      await facadeB.waitForStderr("[magpie] dashboard: http://", 30_000);

      // 3. Verify B re-bound the previous HTTP port (poll until publishHttpPort
      // updates the discovery file post-promotion). The pid in the discovery
      // file is the inner node child's pid, not facadeB.proc.pid (which is
      // the tsx wrapper) — so we only assert the inequality + port match.
      const afterPromotion = await waitForDiscoveryHttpPort(
        HOME,
        (i) => i.pid !== aPid && i.httpPort > 0,
      );
      expect(afterPromotion.pid).not.toBe(aPid);
      expect(afterPromotion.httpPort).toBe(aHttpPort);

      // 4. Spawn fresh facade C → it should connect to B as the new canonical
      // and see B's pid + httpPort in the boot banner.
      const facadeC = spawnMagpie(HOME);
      try {
        await facadeC.waitForStderr("[magpie] connected as facade to canonical pid=", 45_000);
        const banner = facadeC.stderr();
        expect(banner).toContain(`pid=${afterPromotion.pid}`);
        expect(banner).toContain(`http=:${afterPromotion.httpPort}`);
      } finally {
        killProcessTree(facadeC.proc, "SIGKILL");
      }
    },
    120_000,
  );
});
