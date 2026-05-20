import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { setupWs, teardownWs } from '../http/ws.js';

interface WsTry {
  status: 'open' | 'rejected';
  code?: number;
  message?: string;
}

function start(): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer();
    setupWs(server);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const url = `ws://127.0.0.1:${port}/ws`;
      resolve({
        server,
        url,
        close: () =>
          new Promise<void>((done) => {
            teardownWs();
            server.close(() => done());
          }),
      });
    });
  });
}

function tryConnect(url: string, headers: Record<string, string>): Promise<WsTry> {
  return new Promise((resolve) => {
    const sock = new WebSocket(url, { headers });
    let settled = false;
    const settle = (r: WsTry) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* ignore */ }
      resolve(r);
    };
    sock.on('open', () => settle({ status: 'open' }));
    sock.on('unexpected-response', (_req, res) => {
      settle({ status: 'rejected', code: res.statusCode, message: res.statusMessage });
    });
    sock.on('error', (err) => settle({ status: 'rejected', message: (err as Error).message }));
    setTimeout(() => settle({ status: 'rejected', message: 'timeout' }), 2000);
  });
}

describe('A6 · WS upgrade · Origin / Host guard', () => {
  let handle: Awaited<ReturnType<typeof start>> | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it('allows WS upgrade with same-origin (http://127.0.0.1:<port>)', async () => {
    handle = await start();
    const port = new URL(handle.url.replace('ws://', 'http://')).port;
    const result = await tryConnect(handle.url, { Origin: `http://127.0.0.1:${port}` });
    expect(result.status).toBe('open');
  });

  it('allows WS upgrade with no Origin (non-browser client)', async () => {
    handle = await start();
    const result = await tryConnect(handle.url, {});
    expect(result.status).toBe('open');
  });

  it('REJECTS WS upgrade with cross-origin Origin header', async () => {
    handle = await start();
    const result = await tryConnect(handle.url, { Origin: 'http://attacker.example' });
    expect(result.status).toBe('rejected');
    expect(result.code).toBe(403);
  });

  it('REJECTS WS upgrade with https Origin (Magpie is http-only on localhost)', async () => {
    handle = await start();
    const result = await tryConnect(handle.url, { Origin: 'https://127.0.0.1:3737' });
    expect(result.status).toBe('rejected');
    expect(result.code).toBe(403);
  });

  it('REJECTS WS upgrade with literal "null" Origin (sandboxed iframe)', async () => {
    handle = await start();
    const result = await tryConnect(handle.url, { Origin: 'null' });
    expect(result.status).toBe('rejected');
    expect(result.code).toBe(403);
  });

  it('REJECTS WS upgrade with attacker Host header (DNS rebind shape)', async () => {
    handle = await start();
    const result = await tryConnect(handle.url, { Host: 'attacker.example' });
    expect(result.status).toBe('rejected');
    expect(result.code).toBe(403);
  });
});
