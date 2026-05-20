// Canonical-side IPC server — accepts facade connections, recognizes the
// `hello` handshake frame (sets per-connection cwd), and emits connection
// events. Each connection's stream of regular frames is delivered to caller-
// supplied `onFrame` listeners — S2's index.ts wires each connection up to an
// IpcMcpTransport + a fresh MCP Server instance.

import { EventEmitter } from "node:events";
import type { Socket, Server as NetServer } from "node:net";
import { frame, makeFramer } from "./frame.js";

export type HelloFrame = { type: "hello"; cwd?: string };

export type FacadeConnection = {
  /** Stable id assigned by canonical for the lifetime of this socket. */
  id: number;
  /** Cwd reported by facade at handshake; undefined if no hello received. */
  cwd?: string;
  /** Send a frame to this facade. */
  send: (msg: unknown) => void;
  /** Register a callback for each incoming frame (post-hello). */
  onFrame: (cb: (msg: unknown) => void) => () => void;
  /** Register a callback for connection close. */
  onClose: (cb: () => void) => () => void;
  /** Close from canonical side. */
  close: () => void;
};

export interface IpcServer extends EventEmitter {
  on(event: "connection", listener: (conn: FacadeConnection) => void): this;
}

export type IpcServerHandle = IpcServer & {
  /** All currently-attached facades. */
  connections: () => FacadeConnection[];
  /** Stop accepting new connections, close all live ones, close the server. */
  close: () => Promise<void>;
};

export function startIpcServer(server: NetServer): IpcServerHandle {
  const emitter = new EventEmitter() as IpcServerHandle;
  const conns = new Map<number, { sock: Socket; meta: FacadeConnection; frameListeners: Set<(m: unknown) => void>; closeListeners: Set<() => void> }>();
  let nextId = 1;

  server.on("connection", (sock: Socket) => {
    const id = nextId++;
    const frameListeners = new Set<(m: unknown) => void>();
    const closeListeners = new Set<() => void>();

    const meta: FacadeConnection = {
      id,
      send: (msg: unknown) => {
        try {
          sock.write(frame(msg));
        } catch {
          /* socket closed */
        }
      },
      onFrame: (cb) => {
        frameListeners.add(cb);
        return () => frameListeners.delete(cb);
      },
      onClose: (cb) => {
        closeListeners.add(cb);
        return () => closeListeners.delete(cb);
      },
      close: () => {
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
      },
    };

    conns.set(id, { sock, meta, frameListeners, closeListeners });

    let helloReceived = false;
    sock.on(
      "data",
      makeFramer((raw) => {
        if (!helloReceived && isHello(raw)) {
          helloReceived = true;
          meta.cwd = raw.cwd;
          emitter.emit("connection", meta);
          return;
        }
        // Pre-hello frames before any hello: assume legacy client, treat as
        // hello-less connect.
        if (!helloReceived) {
          helloReceived = true;
          emitter.emit("connection", meta);
        }
        for (const cb of frameListeners) cb(raw);
      })
    );

    sock.on("close", () => {
      for (const cb of closeListeners) cb();
      conns.delete(id);
    });
    sock.on("error", () => {
      /* close handler removes the entry */
    });
  });

  emitter.connections = () => Array.from(conns.values(), (c) => c.meta);
  emitter.close = async () => {
    for (const { sock, closeListeners } of conns.values()) {
      for (const cb of closeListeners) cb();
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return emitter;
}

function isHello(raw: unknown): raw is HelloFrame {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { type?: unknown }).type === "hello"
  );
}
