#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
import { config, CONFIG_SNIPPETS, VERSION } from "./config.js";
import { backupHome } from "./cli/backup.js";
import { installSkill } from "./cli/install-skill.js";
import { uninstallSkill } from "./cli/uninstall-skill.js";
import { startMcpServer, attachMagpieServer } from "./mcp/server.js";
import { startHttpServer } from "./http/server.js";
import { closeDb, getDb } from "./store/db.js";
import { shutdownRender } from "./render/index.js";
import {
  acquireLock,
  publishHttpPort,
  releaseLock,
  type LockResult,
} from "./lifecycle/lock.js";
import { startIpcServer, type FacadeConnection } from "./lifecycle/ipc-server.js";
import { connectIpcClient, type IpcClientHandle } from "./lifecycle/ipc-client.js";
import { IpcMcpTransport } from "./lifecycle/ipc-mcp-transport.js";
import { buildCanonicalRestartErrorsFor } from "./lifecycle/canonical-restart.js";
import { openDbWithRetry } from "./lifecycle/db-open-retry.js";
import { redactPath } from "./util/redact.js";

const HELP = `Magpie MCP — your loyal Magpie lands every visual in the nest

Usage:
  magpie-mcp                       Start the MCP server (stdio) + dashboard HTTP server
  magpie-mcp --print-config        Print example MCP host config snippets
  magpie-mcp --install-skill       Install magpie-master skill into Claude Code (~/.claude/skills/)
  magpie-mcp --install-skill --force  Overwrite an edited / older installed skill
  magpie-mcp --uninstall-skill     Remove magpie-master skill from Claude Code
  magpie-mcp --backup <path>       Atomic tar snapshot of MAGPIE_HOME (DB + blobs + skill)
  magpie-mcp --backup <path> --gzip       Same, piped through gzip (.tar.gz)
  magpie-mcp --backup <path> --force      Overwrite an existing backup file
  magpie-mcp --version             Print version
  magpie-mcp --help                Print this message

Environment:
  MAGPIE_HOME         Storage root (default: ~/.magpie)
  MAGPIE_PORT         Preferred dashboard port, scans up from here (default: 3737)
  MAGPIE_BIND         HTTP bind address (default: 127.0.0.1)
  MAGPIE_CHROME_PATH  Override puppeteer Chrome detection
  MAGPIE_NO_FACADE    1 = boot as canonical with a per-PID pipe even if another canonical exists.
                      Diagnostic flag only — two canonicals can race on the shared SQLite database.
`;

function takeFlagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const next = argv[i + 1];
  if (!next || next.startsWith("-")) return null;
  return next;
}

async function handleFlags(argv: string[]): Promise<boolean> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return true;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return true;
  }
  if (argv.includes("--print-config")) {
    process.stdout.write(CONFIG_SNIPPETS);
    return true;
  }
  if (argv.includes("--install-skill")) {
    const result = installSkill({ force: argv.includes("--force") });
    const out = result.exitCode === 0 ? process.stdout : process.stderr;
    out.write(`${result.message}\n`);
    process.exit(result.exitCode);
  }
  if (argv.includes("--uninstall-skill")) {
    const result = uninstallSkill();
    const out = result.exitCode === 0 ? process.stdout : process.stderr;
    out.write(`${result.message}\n`);
    process.exit(result.exitCode);
  }
  if (argv.includes("--backup")) {
    const output = takeFlagValue(argv, "--backup");
    if (!output) {
      process.stderr.write("magpie-mcp --backup: <path> argument required.\n");
      process.exit(1);
    }
    const result = await backupHome({
      home: config.home,
      output,
      gzip: argv.includes("--gzip"),
      force: argv.includes("--force"),
    });
    const out = result.exitCode === 0 ? process.stdout : process.stderr;
    out.write(`${result.message}\n`);
    process.exit(result.exitCode);
  }
  return false;
}

function wireFacadeConnection(conn: FacadeConnection): void {
  const transport = new IpcMcpTransport({
    send: (msg) => conn.send(msg),
    registerClose: (fire) => {
      conn.onClose(fire);
    },
  });
  conn.onFrame((raw) => {
    transport.feed(raw as Parameters<typeof transport.feed>[0]);
  });
  // Each facade gets its own MCP Server instance sharing the global tool /
  // prompt / resource registries. originCwd is the facade's reported cwd.
  void attachMagpieServer(transport, {
    sessionId: `facade-${conn.id}`,
    originCwd: conn.cwd,
  }).catch((err) => {
    console.error(`[magpie] facade ${conn.id} attach failed:`, err);
    conn.close();
  });
}

async function runCanonical(lock: Extract<LockResult, { role: "canonical" }>): Promise<void> {
  const banner = lock.previousHttpPort
    ? `[magpie] promoted to canonical pid=${lock.info.pid} ipc=${lock.info.ipcPath} (prev httpPort=${lock.previousHttpPort})`
    : `[magpie] canonical pid=${lock.info.pid} ipc=${lock.info.ipcPath}`;
  console.error(banner);

  const ipc = startIpcServer(lock.server);
  ipc.on("connection", (conn) => {
    console.error(`[magpie] facade attached id=${conn.id} cwd=${conn.cwd ?? "(unknown)"}`);
    wireFacadeConnection(conn);
  });

  await openDbWithRetry(() => getDb());
  const http = await startHttpServer({ preferredPort: lock.previousHttpPort });
  console.error(`[magpie] dashboard: http://${config.bind}:${http.port}`);
  console.error(`[magpie] last port written to: ${redactPath(config.lastPortFile)}`);

  try {
    publishHttpPort(config.home, http.port);
  } catch (err) {
    console.error("[magpie] warning: could not publish httpPort to discovery file:", err);
  }

  const shutdown = async (signal: string) => {
    console.error(`[magpie] ${signal} — shutting down`);
    try {
      await ipc.close();
      await http.close();
      await shutdownRender();
      closeDb();
    } finally {
      releaseLock(config.home);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await startMcpServer();
}

type FacadeExit = "host-disconnect" | "canonical-died";

async function runFacade(lock: Extract<LockResult, { role: "facade" }>): Promise<FacadeExit> {
  console.error(
    `[magpie] connected as facade to canonical pid=${lock.canonical.pid} ipc=${lock.canonical.ipcPath} http=:${lock.canonical.httpPort}`,
  );

  // Track in-flight request ids. Host → facade requests carry an id + method;
  // canonical → host replies carry the same id; notifications carry no id.
  // On canonical death we emit a JSON-RPC error per pending id so the host SDK
  // can retry instead of hanging forever.
  const pendingIds = new Set<string | number>();

  let client: IpcClientHandle;
  try {
    client = await connectIpcClient(lock.canonical.ipcPath, (msg) => {
      const reply = msg as { id?: string | number };
      if (reply.id !== undefined) pendingIds.delete(reply.id);
      try {
        process.stdout.write(JSON.stringify(msg) + "\n");
      } catch {
        /* stdout closed; nothing useful to do */
      }
    });
  } catch (err) {
    console.error("[magpie] facade could not connect to canonical:", err);
    return "canonical-died";
  }

  // Hello handshake — give canonical our cwd before any MCP traffic flows.
  client.send({ type: "hello", cwd: process.cwd() });

  // Pipe host stdin (NDJSON MCP) → canonical via IPC. Track ids for requests
  // so canonical-death can drain them.
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as { id?: string | number; method?: string };
      if (msg.id !== undefined && typeof msg.method === "string") {
        pendingIds.add(msg.id);
      }
      client.send(msg);
    } catch {
      // Drop unparseable lines silently. Host should never emit these.
    }
  });

  return await new Promise<FacadeExit>((resolve) => {
    let resolved = false;
    const finish = (reason: FacadeExit) => {
      if (resolved) return;
      resolved = true;
      resolve(reason);
    };
    process.once("SIGINT", () => finish("host-disconnect"));
    process.once("SIGTERM", () => finish("host-disconnect"));
    rl.once("close", () => finish("host-disconnect"));
    client.closed.then(
      () => {
        drainPendingAsCanonicalRestart(pendingIds);
        finish("canonical-died");
      },
      () => {
        drainPendingAsCanonicalRestart(pendingIds);
        finish("canonical-died");
      },
    );
  }).finally(() => {
    try {
      rl.close();
    } catch {
      /* ignore */
    }
    client.close();
  });
}

function drainPendingAsCanonicalRestart(pendingIds: Set<string | number>): void {
  for (const errFrame of buildCanonicalRestartErrorsFor(pendingIds)) {
    try {
      process.stdout.write(JSON.stringify(errFrame) + "\n");
    } catch {
      /* stdout closed */
    }
  }
  pendingIds.clear();
}

async function main(): Promise<void> {
  if (await handleFlags(process.argv.slice(2))) return;

  fs.mkdirSync(config.home, { recursive: true });

  const forceCanonical = process.env.MAGPIE_NO_FACADE === "1";
  if (forceCanonical) {
    console.error("[magpie] MAGPIE_NO_FACADE=1 — booting as standalone canonical (debug)");
  }

  // Re-entrant boot loop. Facade exits with "canonical-died" → retry boot fork
  // to either promote to canonical or reconnect to a new facade. Exits with
  // "host-disconnect" → host stdin EOF → process should exit.
  // Canonical never returns from runCanonical except via SIGINT/SIGTERM
  // (process.exit inside the shutdown handler).
  while (true) {
    const lock = await acquireLock(config.home, { forceCanonical });
    if (lock.role === "canonical") {
      await runCanonical(lock);
      return;
    }
    const exit = await runFacade(lock);
    if (exit === "host-disconnect") {
      process.exit(0);
    }
    // exit === "canonical-died" — loop back into acquireLock, race to promote.
    console.error("[magpie] canonical died — retrying boot fork");
  }
}

main().catch((err) => {
  console.error("[magpie] fatal:", err);
  process.exit(1);
});
