// Spike Probe 2 port — concurrent boot stress.
//
// Spawns CONCURRENCY processes against the same fresh $MAGPIE_HOME, asserts
// exactly 1 canonical role + (CONCURRENCY - 1) facade roles per trial. Repeats
// for TRIALS. Varies cwd across spawns to confirm the machine-scoped lock is
// independent of cwd (R19).
//
// Defaults: TRIALS=3, CONCURRENCY=3 (the real same-machine MCP-host ceiling
// — Claude Code CLI + Claude Desktop + Cursor). Override with
// $env:SPIKE_TRIALS / $env:SPIKE_CONCURRENCY for stress runs.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-process-tree.test-helper.js";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""),
  "..",
  "..",
);
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const ALT_CWD = path.join(tmpdir(), `magpie-probe2-altcwd-${process.pid}`);

const TRIALS = Number(process.env.SPIKE_TRIALS ?? 3);
const CONCURRENCY = Number(process.env.SPIKE_CONCURRENCY ?? 3);

type SpawnedMagpie = {
  proc: ChildProcess;
  stderr: () => string;
  waitForRole: (timeoutMs?: number) => Promise<"canonical" | "facade">;
};

function spawnMagpieRaceable(home: string, cwd: string): SpawnedMagpie {
  const proc = spawn(process.execPath, [TSX_BIN, INDEX_TS], {
    env: { ...process.env, MAGPIE_HOME: home },
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errBuf = "";
  proc.stderr!.on("data", (c) => {
    errBuf += c.toString();
  });
  return {
    proc,
    stderr: () => errBuf,
    waitForRole: (timeoutMs = 30_000) =>
      new Promise<"canonical" | "facade">((resolve, reject) => {
        const test = (buf: string): "canonical" | "facade" | null => {
          if (/\[magpie\] (promoted to )?canonical pid=/.test(buf)) return "canonical";
          if (buf.includes("[magpie] connected as facade")) return "facade";
          return null;
        };
        const initial = test(errBuf);
        if (initial) return resolve(initial);
        const onData = (c: Buffer) => {
          errBuf += c.toString();
          const r = test(errBuf);
          if (r) {
            cleanup();
            resolve(r);
          }
        };
        const onExit = (code: number | null) => {
          cleanup();
          reject(new Error(`process exited code=${code} before role; got: ${errBuf.slice(-400)}`));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `timeout waiting for role banner; got: ${errBuf.slice(-400)}`,
            ),
          );
        }, timeoutMs);
        const cleanup = () => {
          proc.stderr!.off("data", onData);
          proc.off("exit", onExit);
          clearTimeout(timer);
        };
        proc.stderr!.on("data", onData);
        proc.on("exit", onExit);
      }),
  };
}

const trialHomes: string[] = [];

afterAll(async () => {
  // Best-effort cleanup. Each trial cleans its own home in the test body.
  for (const home of trialHomes) {
    if (existsSync(home)) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* tmpdir teardown is best-effort */
      }
    }
  }
  if (existsSync(ALT_CWD)) {
    try {
      rmSync(ALT_CWD, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("probe2-stress (concurrent boot race)", () => {
  // Ensure ALT_CWD exists before any trial runs.
  mkdirSync(ALT_CWD, { recursive: true });

  for (let trialIdx = 0; trialIdx < TRIALS; trialIdx++) {
    it(
      `trial ${trialIdx + 1}/${TRIALS}: ${CONCURRENCY} racers → exactly 1 canonical + ${CONCURRENCY - 1} facade(s)`,
      async () => {
        const home = path.join(tmpdir(), `magpie-probe2-${process.pid}-${Date.now()}-${trialIdx}`);
        if (existsSync(home)) rmSync(home, { recursive: true, force: true });
        mkdirSync(home, { recursive: true });
        trialHomes.push(home);

        const procs: SpawnedMagpie[] = [];
        try {
          // Spawn racers from mixed cwds.
          for (let i = 0; i < CONCURRENCY; i++) {
            const cwd = i % 2 === 0 ? REPO_ROOT : ALT_CWD;
            procs.push(spawnMagpieRaceable(home, cwd));
          }

          // Resolve everyone's role concurrently.
          const roles = await Promise.all(procs.map((p) => p.waitForRole(45_000)));
          const canonicalCount = roles.filter((r) => r === "canonical").length;
          const facadeCount = roles.filter((r) => r === "facade").length;

          expect({ canonical: canonicalCount, facade: facadeCount, total: roles.length }).toEqual({
            canonical: 1,
            facade: CONCURRENCY - 1,
            total: CONCURRENCY,
          });
        } finally {
          for (const p of procs) killProcessTree(p.proc, "SIGTERM");
          await new Promise((r) => setTimeout(r, 250));
          for (const p of procs) killProcessTree(p.proc, "SIGKILL");
          // Wait for OS to release pipe handles before next trial reuses the home.
          await new Promise((r) => setTimeout(r, 500));
          if (existsSync(home)) {
            try {
              rmSync(home, { recursive: true, force: true });
            } catch {
              /* best-effort; afterAll will retry */
            }
          }
        }
      },
      90_000,
    );
  }
});
