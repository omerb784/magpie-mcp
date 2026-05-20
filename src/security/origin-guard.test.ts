import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  originGuard,
  parseHostHeader,
  isAllowedHost,
  isAllowedOrigin,
  isStaticAssetGet,
} from '../http/middleware/origin-guard.js';

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', originGuard);
  app.get('/health', (c) => c.json({ ok: true }));
  app.post('/api/echo', async (c) => c.json(await c.req.json()));
  app.get('/assets/mermaid/mermaid.esm.min.mjs', (c) =>
    c.body('export default {};', 200, { 'Content-Type': 'application/javascript' }),
  );
  app.post('/assets/foo', (c) => c.text('should not reach'));
  return app;
}

function req(url: string, init: RequestInit = {}): Request {
  // Node's fetch / undici does NOT auto-populate the Host header on
  // synthesized Requests — production traffic via @hono/node-server gets
  // Host set by Node's http parser. In tests we have to set it explicitly.
  const u = new URL(url);
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', u.host || u.hostname);
  return new Request(url, { ...init, headers });
}

describe('A6 · parseHostHeader', () => {
  it('strips port from host:port', () => {
    expect(parseHostHeader('127.0.0.1:3737')).toBe('127.0.0.1');
    expect(parseHostHeader('localhost:9999')).toBe('localhost');
  });

  it('returns hostname unchanged when no port', () => {
    expect(parseHostHeader('localhost')).toBe('localhost');
    expect(parseHostHeader('127.0.0.1')).toBe('127.0.0.1');
  });

  it('preserves bracketed IPv6', () => {
    expect(parseHostHeader('[::1]:3737')).toBe('[::1]');
    expect(parseHostHeader('[::1]')).toBe('[::1]');
  });

  it('lower-cases for case-insensitive match', () => {
    expect(parseHostHeader('LOCALHOST:3737')).toBe('localhost');
  });

  it('returns null on missing / empty', () => {
    expect(parseHostHeader(undefined)).toBe(null);
    expect(parseHostHeader('')).toBe(null);
    expect(parseHostHeader('   ')).toBe(null);
  });
});

describe('A6 · isAllowedHost', () => {
  it.each([
    '127.0.0.1', '127.0.0.1:3737', 'localhost', 'localhost:80',
    '[::1]', '[::1]:3737', 'LocalHost:3737',
  ])('allows %s', (h) => expect(isAllowedHost(h)).toBe(true));

  it.each([
    'attacker.example', 'evil.com:3737', '192.168.1.10:3737',
    '127.0.0.1.attacker.com', 'attacker.com:127.0.0.1',
    'attacker.com.localhost', undefined, '',
  ])('rejects %s', (h) => expect(isAllowedHost(h)).toBe(false));
});

describe('A6 · isAllowedOrigin', () => {
  it('allows http://127.0.0.1 + http://localhost (any port)', () => {
    expect(isAllowedOrigin('http://127.0.0.1:3737')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3737')).toBe(true);
    expect(isAllowedOrigin('http://localhost')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:3737')).toBe(true);
  });

  it('allows missing Origin (non-browser clients, direct nav)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('rejects https:// (Magpie serves only http on localhost)', () => {
    expect(isAllowedOrigin('https://127.0.0.1:3737')).toBe(false);
    expect(isAllowedOrigin('https://localhost:3737')).toBe(false);
  });

  it('rejects literal "null" Origin (sandboxed iframe escape)', () => {
    expect(isAllowedOrigin('null')).toBe(false);
  });

  it('rejects every cross-origin shape', () => {
    expect(isAllowedOrigin('http://attacker.example:3737')).toBe(false);
    expect(isAllowedOrigin('http://evil.com')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1.attacker.com:3737')).toBe(false);
    expect(isAllowedOrigin('http://attacker.com#127.0.0.1')).toBe(false);
  });
});

describe('A6 · originGuard middleware · request layer', () => {
  it('allows same-origin GET (Host header set by Request to 127.0.0.1)', async () => {
    const res = await buildApp().fetch(req('http://127.0.0.1:3737/health'));
    expect(res.status).toBe(200);
  });

  it('allows requests against http://localhost (existing test pattern)', async () => {
    const res = await buildApp().fetch(req('http://localhost/health'));
    expect(res.status).toBe(200);
  });

  it('REJECTS DNS-rebind shape — Host header names attacker domain', async () => {
    const res = await buildApp().fetch(
      req('http://attacker.example/health', {
        headers: { Host: 'attacker.example:3737' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Host header.*not an allowed local hostname/);
  });

  it('REJECTS cross-origin POST — Origin from another site', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/api/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://attacker.example',
        },
        body: JSON.stringify({ hi: 1 }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Origin.*not an allowed local origin/);
  });

  it('allows same-origin POST with matching Origin', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/api/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:3737',
        },
        body: JSON.stringify({ hi: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hi: 1 });
  });

  it('allows POST with no Origin (curl / direct, Host still gates it)', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hi: 1 }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('REJECTS https Origin (Magpie does not run TLS on localhost)', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/api/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://127.0.0.1:3737',
        },
        body: JSON.stringify({ hi: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('REJECTS classic DNS rebind: Host=attacker.com tricks initial resolution', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/api/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'attacker.com',
          Origin: 'http://attacker.com',
        },
        body: JSON.stringify({ hi: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

// v0.9.2 Phase F · null-Origin carve-out for static-asset GETs.
// Rationale: puppeteer page.setContent gives the document an opaque
// origin; Origin: null on the mermaid module fetch was being 403'd
// by A6, breaking the render pipeline. Carve-out permits null-Origin
// on GET /assets/* only. Host check still applies. Mutating verbs
// and /api/* still null-Origin-rejected (sandbox-exfil defense holds).

describe('A6 · isStaticAssetGet', () => {
  it('matches GET / HEAD on /assets/ prefix', () => {
    expect(isStaticAssetGet('GET', '/assets/mermaid/x.mjs')).toBe(true);
    expect(isStaticAssetGet('HEAD', '/assets/foo')).toBe(true);
  });
  it('rejects non-/assets/ paths', () => {
    expect(isStaticAssetGet('GET', '/api/projects')).toBe(false);
    expect(isStaticAssetGet('GET', '/health')).toBe(false);
    expect(isStaticAssetGet('GET', '/assets')).toBe(false);
  });
  it('rejects mutating verbs even under /assets/', () => {
    expect(isStaticAssetGet('POST', '/assets/foo')).toBe(false);
    expect(isStaticAssetGet('PUT', '/assets/foo')).toBe(false);
    expect(isStaticAssetGet('DELETE', '/assets/foo')).toBe(false);
    expect(isStaticAssetGet('PATCH', '/assets/foo')).toBe(false);
  });
});

describe('A6 · originGuard middleware · null-Origin static-asset carve-out (Phase F)', () => {
  it('ALLOWS GET /assets/mermaid/*.mjs with Origin: null (puppeteer setContent)', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/assets/mermaid/mermaid.esm.min.mjs', {
        headers: { Origin: 'null' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
  });

  it('STILL REJECTS GET /api/* with Origin: null (sandbox-exfil defense holds)', async () => {
    const app = new Hono();
    app.use('*', originGuard);
    app.get('/api/projects', (c) => c.json([{ secret: 'leak' }]));
    const res = await app.fetch(
      req('http://127.0.0.1:3737/api/projects', {
        headers: { Origin: 'null' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('STILL REJECTS POST /assets/* with Origin: null (mutation surface)', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/assets/foo', {
        method: 'POST',
        headers: { Origin: 'null', 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('STILL REJECTS GET /assets/* with attacker Origin (carve-out is null-only)', async () => {
    const res = await buildApp().fetch(
      req('http://127.0.0.1:3737/assets/mermaid/mermaid.esm.min.mjs', {
        headers: { Origin: 'http://attacker.example' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('STILL REJECTS GET /assets/* with bad Host (rebind defense holds)', async () => {
    const res = await buildApp().fetch(
      req('http://attacker.example:3737/assets/mermaid/mermaid.esm.min.mjs', {
        headers: { Host: 'attacker.example:3737', Origin: 'null' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Host header/);
  });
});
