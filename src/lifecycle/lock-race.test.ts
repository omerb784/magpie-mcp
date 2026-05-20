// Cross-process race: N child processes call acquireLock against the same
// $MAGPIE_HOME. Exactly 1 reports canonical, rest report facade. Uses raw node
// + --experimental-strip-types to avoid bundler / loader overhead — same
// pattern as spike/probe2-stress.ts.
//
// Spike-validated on Windows physical (10/10 trials, 0 double-canonical).
// S4 CI matrix re-runs this on all 3 OSes × Node 20+22.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-process-tree.test-helper.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, "lock-race-child.test-helper.ts");

type ChildResult = { role: "canonical" | "facade"; pid: number };

function spawnRacers(home: string, n: number, timeoutMs = 3000): Promise<ChildResult[]> {
  return new Promise((resolve) => {
    const results: ChildResult[] = [];
    const procs = Array.from({ length: n }, () =>
      spawn(
        process.execPath,
        ["--experimental-strip-types", "--no-warnings", CHILD, home],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    );

    const buffers = procs.map(() => "");
    let exited = 0;

    procs.forEach((p, i) => {
      p.stdout!.on("data", (c) => {
        buffers[i] += c.toString();
      });
      p.on("close", () => {
        for (const line of (buffers[i] ?? "").split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as ChildResult;
            if (parsed.role === "canonical" || parsed.role === "facade") {
              results.push(parsed);
            }
          } catch {
            /* ignore non-JSON noise on stdout */
          }
        }
        if (++exited === n) resolve(results);
      });
    });

    setTimeout(() => {
      for (const p of procs) killProcessTree(p, "SIGKILL");
    }, timeoutMs);
  });
}

let home: string;

beforeEach(() => {
  home = join(
    tmpdir(),
    `magpie-lockrace-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe("lock-race (cross-process)", () => {
  it("3-way concurrent acquire yields exactly 1 canonical and 2 facades", async () => {
    const results = await spawnRacers(home, 3);
    const canonical = results.filter((r) => r.role === "canonical");
    const facade = results.filter((r) => r.role === "facade");
    expect(canonical.length + facade.length, `all 3 children reported (got ${results.length})`).toBe(3);
    expect(canonical, `canonical PIDs: ${JSON.stringify(canonical)}`).toHaveLength(1);
    expect(facade).toHaveLength(2);
  }, 15_000);

  it(
    "5 trials of 3-way concurrent acquire — each yields exactly 1 canonical",
    async () => {
      for (let t = 0; t < 5; t++) {
        const trialHome = join(
          tmpdir(),
          `magpie-lockrace-trial-${process.pid}-${t}-${Math.random().toString(36).slice(2, 8)}`,
        );
        mkdirSync(trialHome, { recursive: true });
        try {
          const results = await spawnRacers(trialHome, 3);
          const canonical = results.filter((r) => r.role === "canonical").length;
          expect(canonical, `trial ${t}: expected 1 canonical, got ${canonical}`).toBe(1);
        } finally {
          rmSync(trialHome, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );
});
