// Length-prefixed JSON framing for IPC traffic between facade and canonical.
// 4-byte little-endian length header + JSON body. Shared by ipc-server.ts and
// ipc-client.ts. Lifted from spike/ipc.ts.

export function frame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj));
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32LE(body.length, 0);
  return Buffer.concat([hdr, body]);
}

export type FrameHandler = (msg: unknown) => void;

/** Build a buffering parser that calls onMsg for each complete frame.
 *  Pass each Buffer chunk from a socket's 'data' event into the returned function. */
export function makeFramer(onMsg: FrameHandler): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      try {
        onMsg(JSON.parse(body.toString()));
      } catch {
        // malformed frame — drop it, keep reading. S2 will add error reporting.
      }
    }
  };
}
