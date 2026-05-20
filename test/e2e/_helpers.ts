// v0.9.3 Phase G — shared e2e helpers.
//
// Pattern lifted from src/lifecycle/facade-e2e.test.ts. Spawns real
// canonical + facade child processes against src/index.ts via tsx, drives
// MCP tools over JSON-RPC stdio against the facade, reads HTTP + WS off
// the canonical's published port (from MAGPIE_HOME/magpie.lock).
//
// Each Phase G spec owns its own .tmp-e2e-{N}/ MAGPIE_HOME so workers
// can't contaminate one another. Lifecycle is bootPair() → mcpInit() →
// drive flow → shutdownPair().

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { killProcessTree } from "../../src/lifecycle/kill-process-tree.test-helper.js";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""),
  "..",
  "..",
);
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

export type SpawnedMagpie = {
  proc: ChildProcess;
  stderr: () => string;
  waitForStderr: (substring: string, timeoutMs?: number) => Promise<void>;
};

export function spawnMagpie(home: string, extraEnv: Record<string, string> = {}): SpawnedMagpie {
  const proc = spawn(process.execPath, [TSX_BIN, INDEX_TS], {
    env: { ...process.env, MAGPIE_HOME: home, ...extraEnv },
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

export type JsonRpcMsg = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
};

export type NdjsonReader = {
  next: () => Promise<JsonRpcMsg>;
  waitForId: (id: number, timeoutMs?: number) => Promise<JsonRpcMsg>;
};

export function readNdjson(proc: ChildProcess): NdjsonReader {
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
          if (Date.now() > deadline)
            return reject(new Error(`timeout waiting for response with id=${id}`));
          setTimeout(tick, 25);
        };
        tick();
      }),
  };
}

export function sendJsonRpc(proc: ChildProcess, msg: object): void {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

export type DiscoveryFile = {
  pid: number;
  ipcPath: string;
  httpPort: number;
  startedAt: number;
};

export function readDiscovery(home: string): DiscoveryFile {
  const raw = readFileSync(path.join(home, "magpie.lock"), "utf8");
  return JSON.parse(raw) as DiscoveryFile;
}

export async function waitForDiscoveryHttpPort(
  home: string,
  predicate: (info: DiscoveryFile) => boolean = (i) => i.httpPort > 0,
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

export type Pair = {
  home: string;
  canonical: SpawnedMagpie;
  facade: SpawnedMagpie;
  reader: NdjsonReader;
  httpPort: number;
  nextRpcId: () => number;
};

export function makeHome(tag: string): string {
  return path.join(tmpdir(), `magpie-e2e-${tag}-${process.pid}-${Date.now()}`);
}

export async function bootPair(home: string, extraEnv: Record<string, string> = {}): Promise<Pair> {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });

  const canonical = spawnMagpie(home, extraEnv);
  await canonical.waitForStderr("[magpie] canonical pid=");
  const discovery = await waitForDiscoveryHttpPort(home);

  const facade = spawnMagpie(home, extraEnv);
  await facade.waitForStderr("[magpie] connected as facade");
  const reader = readNdjson(facade.proc);

  let id = 0;
  return {
    home,
    canonical,
    facade,
    reader,
    httpPort: discovery.httpPort,
    nextRpcId: () => ++id,
  };
}

export async function shutdownPair(pair: Pair | undefined): Promise<void> {
  if (!pair) return;
  killProcessTree(pair.canonical.proc, "SIGTERM");
  killProcessTree(pair.facade.proc, "SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  killProcessTree(pair.canonical.proc, "SIGKILL");
  killProcessTree(pair.facade.proc, "SIGKILL");
  await Promise.all(
    [pair.canonical.proc, pair.facade.proc].map(
      (p) =>
        new Promise<void>((resolve) => {
          if (p.exitCode !== null || p.signalCode !== null) return resolve();
          p.once("exit", () => resolve());
          setTimeout(() => resolve(), 3000);
        }),
    ),
  );
  if (existsSync(pair.home)) {
    try {
      rmSync(pair.home, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(pair.home, { recursive: true, force: true });
      } catch {
        /* leave behind — OS reclaims on reboot */
      }
    }
  }
}

export async function mcpInit(pair: Pair): Promise<void> {
  const id = pair.nextRpcId();
  sendJsonRpc(pair.facade.proc, {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "magpie-e2e-helper", version: "0.0.0" },
    },
  });
  await pair.reader.waitForId(id);
  sendJsonRpc(pair.facade.proc, { jsonrpc: "2.0", method: "notifications/initialized" });
}

export type ToolResult = {
  text: string;
  isError: boolean;
  raw: JsonRpcMsg;
};

export async function mcpCall(
  pair: Pair,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 25_000,
): Promise<ToolResult> {
  const id = pair.nextRpcId();
  sendJsonRpc(pair.facade.proc, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const resp = (await pair.reader.waitForId(id, timeoutMs)) as JsonRpcMsg & {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const text = resp.result?.content?.[0]?.text ?? "";
  return { text, isError: resp.result?.isError === true, raw: resp };
}

// "Saved \"...\" as visual XYZ v1 in project \"...\"." → "XYZ".
export function parseVisualId(text: string): string {
  const m = text.match(/visual ([A-Za-z0-9_-]{6,32})\b/);
  if (!m) throw new Error(`no visual_id in tool response: ${text}`);
  return m[1]!;
}

// "Inbox: ... [XYZ] visual ...". Returns first id surfaced.
export function parseInboxId(text: string): string {
  const m = text.match(/\[([A-Za-z0-9_-]{8,})\]/);
  if (!m) throw new Error(`no inbox id in tool response: ${text}`);
  return m[1]!;
}

export type HttpReply = {
  status: number;
  text: string;
  headers: Headers;
};

export async function httpGet(pair: Pair, p: string): Promise<HttpReply> {
  const url = `http://127.0.0.1:${pair.httpPort}${p}`;
  const r = await fetch(url, { headers: { Host: "127.0.0.1" } });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

export async function httpPostJson(
  pair: Pair,
  p: string,
  body: unknown,
): Promise<HttpReply & { json: unknown }> {
  const url = `http://127.0.0.1:${pair.httpPort}${p}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Host: "127.0.0.1",
      Origin: `http://127.0.0.1:${pair.httpPort}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: r.status, text, headers: r.headers, json };
}

export async function httpDelete(pair: Pair, p: string): Promise<HttpReply & { json: unknown }> {
  const url = `http://127.0.0.1:${pair.httpPort}${p}`;
  const r = await fetch(url, {
    method: "DELETE",
    headers: {
      Host: "127.0.0.1",
      Origin: `http://127.0.0.1:${pair.httpPort}`,
    },
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: r.status, text, headers: r.headers, json };
}

export type WsEvent = {
  kind: string;
  [k: string]: unknown;
};

export type WsHandle = {
  socket: WebSocket;
  events: WsEvent[];
  waitFor: (predicate: (e: WsEvent) => boolean, timeoutMs?: number) => Promise<WsEvent>;
  close: () => Promise<void>;
};

export async function openWs(pair: Pair): Promise<WsHandle> {
  const url = `ws://127.0.0.1:${pair.httpPort}/ws`;
  const socket = new WebSocket(url, {
    headers: { Origin: `http://127.0.0.1:${pair.httpPort}` },
  });
  const events: WsEvent[] = [];
  const waiters: Array<{
    predicate: (e: WsEvent) => boolean;
    resolve: (e: WsEvent) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  socket.on("message", (data) => {
    try {
      const ev = JSON.parse(data.toString()) as WsEvent;
      events.push(ev);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!;
        if (w.predicate(ev)) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(ev);
        }
      }
    } catch {
      /* ignore non-JSON */
    }
  });
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      socket.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      socket.off("open", onOpen);
      reject(err);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
  return {
    socket,
    events,
    waitFor: (predicate, timeoutMs = 10_000) =>
      new Promise<WsEvent>((resolve, reject) => {
        const existing = events.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.predicate === predicate);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`ws.waitFor timeout after ${timeoutMs}ms; last events: ${JSON.stringify(events.slice(-5))}`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.once("close", () => resolve());
        try {
          socket.close();
        } catch {
          resolve();
        }
        setTimeout(() => resolve(), 1500);
      }),
  };
}
