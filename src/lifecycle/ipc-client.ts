// Facade-side IPC client — connects to canonical's pipe, forwards frames, surfaces
// canonical death via close events. S1 only opens the socket and exposes it; S2
// wires it to the stdio MCP forwarding loop.

import net from "node:net";
import type { Socket } from "node:net";
import { frame, makeFramer } from "./frame.js";

export type CanonicalReplyHandler = (msg: unknown) => void;

export type IpcClientHandle = {
  /** Send a frame to canonical. */
  send: (msg: unknown) => void;
  /** Resolves when the underlying socket closes (canonical died or shut down). */
  closed: Promise<void>;
  /** Force-close from facade side. */
  close: () => void;
};

export class IpcConnectError extends Error {
  override readonly name = "IpcConnectError";
}

export function connectIpcClient(
  ipcPath: string,
  onReply: CanonicalReplyHandler,
): Promise<IpcClientHandle> {
  return new Promise((resolve, reject) => {
    const sock: Socket = net.connect(ipcPath);
    let closeResolve: () => void;
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });

    sock.once("connect", () => {
      sock.on("data", makeFramer(onReply));
      sock.on("close", () => closeResolve());
      sock.on("error", () => {
        /* close handler will fire too */
      });
      resolve({
        send: (msg: unknown) => {
          try {
            sock.write(frame(msg));
          } catch {
            /* socket closed; closed promise will fire */
          }
        },
        closed,
        close: () => {
          try {
            sock.destroy();
          } catch {
            /* ignore */
          }
        },
      });
    });

    sock.once("error", (err: NodeJS.ErrnoException) => {
      reject(new IpcConnectError(`failed to connect to canonical at ${ipcPath}: ${err.code ?? err.message}`));
    });
  });
}
