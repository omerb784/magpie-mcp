// Transport adapter — bridges length-prefixed IPC frames to the MCP SDK's
// JSON-RPC Transport interface. One instance per facade connection on canonical;
// the SDK Server instance attaches to it via .connect(transport).
//
// Asymmetric usage:
//   - send(msg) : Server → outbound JSON-RPC frame written to IPC socket
//   - feed(msg) : IPC socket → inbound JSON-RPC frame delivered to Server

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type IpcMcpTransportOptions = {
  /** Send a frame outbound (toward facade). Caller wraps in length-prefix framing. */
  send: (msg: JSONRPCMessage) => void;
  /** Optional close trigger so the SDK Server learns about socket teardown. */
  registerClose?: (fire: () => void) => void;
};

export class IpcMcpTransport implements Transport {
  public onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;

  private closed = false;
  private readonly send_: (msg: JSONRPCMessage) => void;

  constructor(opts: IpcMcpTransportOptions) {
    this.send_ = opts.send;
    opts.registerClose?.(() => {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    });
  }

  async start(): Promise<void> {
    /* nothing — IPC socket is already connected when this transport is built */
  }

  async send(msg: JSONRPCMessage): Promise<void> {
    if (this.closed) return;
    try {
      this.send_(msg);
    } catch (err) {
      this.onerror?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Push an inbound frame received from the IPC socket into the SDK Server. */
  feed(msg: JSONRPCMessage): void {
    if (this.closed) return;
    this.onmessage?.(msg);
  }
}
