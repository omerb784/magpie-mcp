import type { Server as HttpServer } from "node:http";
import type { Http2Server, Http2SecureServer } from "node:http2";
import { WebSocketServer, WebSocket } from "ws";
import { isAllowedHost, isAllowedOrigin } from "./middleware/origin-guard.js";
import { isMcpConnected, onMcpStateChange } from "./mcp-state.js";

type AnyHttpServer = HttpServer | Http2Server | Http2SecureServer;

export type WsEvent =
  | { kind: "visual.created"; visual_id: string }
  | { kind: "visual.updated"; visual_id: string }
  | { kind: "version.added"; visual_id: string; version_num: number }
  | {
      kind: "version.rendered";
      visual_id: string;
      version_num: number;
      status: "ok" | "warn" | "failed";
      thumb_path: string | null;
    }
  | { kind: "mcp.connected" }
  | { kind: "mcp.disconnected" }
  | { kind: "inbox.added"; id: string }
  | { kind: "inbox.consumed"; ids: string[] }
  | { kind: "inbox.deleted"; id: string };

let wss: WebSocketServer | null = null;
let unsubscribeMcpState: (() => void) | null = null;

export function setupWs(server: AnyHttpServer): void {
  if (wss) {
    wss.close();
    wss = null;
  }
  if (unsubscribeMcpState) {
    unsubscribeMcpState();
    unsubscribeMcpState = null;
  }
  wss = new WebSocketServer({
    server: server as HttpServer,
    path: "/ws",
    verifyClient: (info, cb) => {
      const origin = info.origin;
      if (!isAllowedOrigin(origin)) {
        cb(false, 403, "Forbidden: Origin not allowed");
        return;
      }
      const host = info.req.headers.host;
      if (!isAllowedHost(host)) {
        cb(false, 403, "Forbidden: Host not allowed");
        return;
      }
      cb(true);
    },
  });
  wss.on("connection", (sock) => {
    sock.on("error", () => {
      // swallow — broken sockets disconnect cleanly via 'close'
    });
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ kind: isMcpConnected() ? "mcp.connected" : "mcp.disconnected" }));
    }
  });
  unsubscribeMcpState = onMcpStateChange((connected) =>
    broadcast({ kind: connected ? "mcp.connected" : "mcp.disconnected" })
  );
}

export function teardownWs(): void {
  if (unsubscribeMcpState) {
    unsubscribeMcpState();
    unsubscribeMcpState = null;
  }
  if (!wss) return;
  for (const client of wss.clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  wss.close();
  wss = null;
}

export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
