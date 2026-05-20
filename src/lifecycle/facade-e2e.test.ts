// End-to-end: spawn canonical + facade as real child processes. Send MCP
// JSON-RPC into facade's stdin, read replies from facade's stdout, assert
// canonical's tool registry answered.
//
// Both children run via `node --experimental-strip-types` against this repo's
// src/index.ts directly — no build step required.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-process-tree.test-helper.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type SpawnedMagpie = {
  proc: ChildProcess;
  stderr: () => string;
  waitForStderr: (substring: string, timeoutMs?: number) => Promise<void>;
};

function spawnMagpie(home: string): SpawnedMagpie {
  // Use tsx so the spawned child resolves the existing `import "./config.js"`
  // style imports inside src/ — `--experimental-strip-types` alone won't.
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
          reject(new Error(`timeout waiting for stderr to contain ${JSON.stringify(sub)}; got: ${errBuf.slice(-500)}`));
        }, timeoutMs);
        const cleanup = () => {
          proc.stderr!.off("data", onData);
          clearTimeout(timer);
        };
        proc.stderr!.on("data", onData);
      }),
  };
}

type JsonRpcMsg = { jsonrpc?: string; id?: number | string; method?: string; result?: unknown; error?: unknown };

function readNdjson(proc: ChildProcess): {
  next: () => Promise<JsonRpcMsg>;
  waitForId: (id: number, timeoutMs?: number) => Promise<JsonRpcMsg>;
} {
  let buffer = "";
  const queue: JsonRpcMsg[] = [];
  const waiters: Array<(v: JsonRpcMsg) => void> = [];
  proc.stdout!.on("data", (c) => {
    buffer += c.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMsg;
        const w = waiters.shift();
        if (w) w(msg);
        else queue.push(msg);
      } catch {
        /* ignore non-JSON */
      }
    }
  });
  return {
    next: () =>
      new Promise<JsonRpcMsg>((resolve) => {
        const msg = queue.shift();
        if (msg !== undefined) return resolve(msg);
        waiters.push(resolve);
      }),
    waitForId: (id, timeoutMs = 25_000) =>
      new Promise<JsonRpcMsg>((resolve, reject) => {
        const startIdx = queue.findIndex((m) => m.id === id);
        if (startIdx >= 0) {
          const [match] = queue.splice(startIdx, 1);
          return resolve(match!);
        }
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          const idx = queue.findIndex((m) => m.id === id);
          if (idx >= 0) {
            const [match] = queue.splice(idx, 1);
            return resolve(match!);
          }
          if (Date.now() > deadline) return reject(new Error(`timeout waiting for response with id=${id}`));
          setTimeout(tick, 25);
        };
        tick();
      }),
  };
}

function sendJsonRpc(proc: ChildProcess, msg: object): void {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

const HOME = path.join(tmpdir(), `magpie-e2e-${process.pid}-${Date.now()}`);
let canonical: SpawnedMagpie | undefined;
let facade: SpawnedMagpie | undefined;
let facadeReader: ReturnType<typeof readNdjson> | undefined;

beforeAll(async () => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });

  canonical = spawnMagpie(HOME);
  await canonical.waitForStderr("[magpie] canonical pid=");

  facade = spawnMagpie(HOME);
  await facade.waitForStderr("[magpie] connected as facade");
  facadeReader = readNdjson(facade.proc);
}, 120_000);

afterAll(async () => {
  killProcessTree(canonical?.proc, "SIGTERM");
  killProcessTree(facade?.proc, "SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  killProcessTree(canonical?.proc, "SIGKILL");
  killProcessTree(facade?.proc, "SIGKILL");
  // v0.9.3 - Wait for child processes to fully exit before rmSync. On Windows,
  // SIGKILL doesn't release filesystem handles synchronously; immediate rmSync
  // races and throws EPERM. Poll exitCode until both children are reaped.
  await Promise.all(
    [canonical?.proc, facade?.proc].filter(Boolean).map(
      (p) =>
        new Promise<void>((resolve) => {
          if (p!.exitCode !== null || p!.signalCode !== null) return resolve();
          p!.once("exit", () => resolve());
          setTimeout(() => resolve(), 3000);
        }),
    ),
  );
  if (existsSync(HOME)) {
    // Retry once on Windows if a stray file handle outlived the exit event.
    try {
      rmSync(HOME, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(HOME, { recursive: true, force: true });
      } catch {
        /* leave the temp dir behind — OS will clean on reboot */
      }
    }
  }
});

describe("facade ↔ canonical end-to-end", () => {
  it(
    "facade-spawned initialize + tools/list returns the Magpie tool registry",
    async () => {
      if (!facade || !facadeReader) throw new Error("setup failed");

      // 1. MCP handshake — host MUST send initialize first.
      sendJsonRpc(facade.proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "facade-e2e-test", version: "0.0.0" },
        },
      });
      const initResp = (await facadeReader.waitForId(1)) as JsonRpcMsg & {
        result?: { serverInfo?: { name?: string } };
      };
      expect(initResp.jsonrpc).toBe("2.0");
      expect(initResp.id).toBe(1);
      expect(initResp.result?.serverInfo?.name).toBe("magpie-mcp");

      // 2. The notifications/initialized notification (no reply expected).
      sendJsonRpc(facade.proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // 3. tools/list — proves canonical's tool registry is reachable through
      //    the facade-IPC-canonical-dispatch path.
      sendJsonRpc(facade.proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const listResp = (await facadeReader.waitForId(2)) as JsonRpcMsg & {
        result?: { tools?: Array<{ name: string }> };
      };
      expect(listResp.id).toBe(2);
      const toolNames = (listResp.result?.tools ?? []).map((t) => t.name).sort();
      // Spot-check a few known Magpie tools — exhaustive count is locked in
      // R6/R11 but the test should not be brittle to additions.
      expect(toolNames).toContain("create_project");
      expect(toolNames).toContain("add_visual");
      expect(toolNames).toContain("find_visuals");
      expect(toolNames).toContain("iterate");
      expect(toolNames).toContain("list_projects");
    },
    20_000,
  );

  it(
    "canonical reports facade attached with cwd from hello frame",
    async () => {
      if (!canonical) throw new Error("setup failed");
      // The "facade attached id=... cwd=..." stderr line is emitted by
      // runCanonical on each ipc connection event. Confirm cwd present.
      const errOut = canonical.stderr();
      expect(errOut).toMatch(/facade attached id=\d+ cwd=/);
      expect(errOut).not.toMatch(/facade attached id=\d+ cwd=\(unknown\)/);
    },
    5_000,
  );

  it(
    "facade-spawned add_visual writes a row that find_visuals reads back",
    async () => {
      if (!facade || !facadeReader) throw new Error("setup failed");

      sendJsonRpc(facade.proc, {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "add_visual",
          arguments: {
            project: "facade-e2e",
            type: "markdown",
            title: "Hello from facade",
            content: "# from facade\n\nProof that S2 forwarding works.",
          },
        },
      });
      const addResp = (await facadeReader.waitForId(10)) as JsonRpcMsg & {
        result?: { content?: Array<{ text?: string }>; isError?: boolean };
      };
      expect(addResp.id).toBe(10);
      expect(addResp.result?.isError).not.toBe(true);
      const addText = addResp.result?.content?.[0]?.text ?? "";
      expect(addText).toMatch(/Saved "Hello from facade" as visual /);

      // Read back via find_visuals — same forwarding path, proves both
      // directions work.
      sendJsonRpc(facade.proc, {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "find_visuals",
          arguments: { project: "facade-e2e" },
        },
      });
      const findResp = (await facadeReader.waitForId(11)) as JsonRpcMsg & {
        result?: { content?: Array<{ text?: string }> };
      };
      expect(findResp.id).toBe(11);
      const findText = findResp.result?.content?.[0]?.text ?? "";
      expect(findText).toContain("Hello from facade");
      expect(findText).toContain("facade-e2e");
    },
    30_000,
  );
});
