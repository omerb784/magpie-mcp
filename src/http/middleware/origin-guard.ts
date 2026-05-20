// v0.9.2 Phase B / A6 — Origin + Host header guard.
//
// Defends against cross-origin browser attacks (DNS rebinding,
// drive-by JS in another tab fetching http://127.0.0.1:<port>/api/...).
// Magpie binds to 127.0.0.1 — local-only — but the browser will still
// happily send requests on behalf of any tab. The browser does NOT
// shield this server, so the server must shield itself.
//
// Rejection rules:
//   * Host header MUST be 127.0.0.1, localhost, or [::1] (port-agnostic).
//     A request whose Host names any other domain is a rebind attempt or
//     misconfiguration; either way we reject.
//   * Origin header, when present, MUST be http://<allowed-host>. Most
//     browser-issued cross-origin requests set Origin; missing Origin is
//     allowed for direct nav / CLI clients (Host check still applies).
//
// Port-agnostic by design — rebind attacks rely on swapping the
// hostname, not the port. Requiring an exact port match would also
// break existing tests that issue Request('http://localhost/path').
//
// v0.9.2 Phase F · null-Origin carve-out for static assets.
//   A page loaded via puppeteer `page.setContent(html)` has an opaque
//   origin — every outbound request it makes carries `Origin: null`.
//   The render pipeline (mermaid shell) imports its JS module from
//   `/assets/mermaid/...` on the same Magpie server. Pre-carve-out,
//   the Origin-null rule sank that fetch with a 403 and Chrome's
//   CORS layer reported "No 'Access-Control-Allow-Origin' header is
//   present" (because origin-guard's 403 body never carried CORS
//   headers) — so mermaid never loaded and the thumbnail render
//   hung to timeout.
//   Fix: permit `Origin: null` ONLY on GET requests for paths under
//   `/assets/`. Static-asset GETs return public bundled files
//   (mermaid module, future UI assets) — zero mutation surface, no
//   private data leak. The sandboxed-iframe-exfil threat that A6
//   defends still holds for `/api/*` GETs + every mutating verb.

import type { MiddlewareHandler } from 'hono';

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parseHostHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close >= 0 ? trimmed.slice(0, close + 1) : trimmed;
  }
  const colon = trimmed.lastIndexOf(':');
  return colon >= 0 ? trimmed.slice(0, colon) : trimmed;
}

export function isAllowedHost(raw: string | undefined): boolean {
  const hostname = parseHostHeader(raw);
  return hostname !== null && ALLOWED_HOSTNAMES.has(hostname);
}

export function isAllowedOrigin(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null || raw === '') return true;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'null') return false;
  if (!trimmed.startsWith('http://')) return false;
  return isAllowedHost(trimmed.slice('http://'.length));
}

export function isStaticAssetGet(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return path.startsWith('/assets/');
}

export const originGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host');
  if (!isAllowedHost(host)) {
    return c.text(
      `Forbidden: Host header '${host ?? '<missing>'}' is not an allowed local hostname`,
      403,
    );
  }
  const origin = c.req.header('origin');
  if (!isAllowedOrigin(origin)) {
    // Carve-out: permit literal `Origin: null` (opaque origin) on
    // GET /assets/* only. Other rejected Origins (attacker domains,
    // https, etc.) still 403. See file header for rationale.
    const isNullOrigin = origin?.trim().toLowerCase() === 'null';
    const path = new URL(c.req.url).pathname;
    if (!(isNullOrigin && isStaticAssetGet(c.req.method, path))) {
      return c.text(
        `Forbidden: Origin '${origin}' is not an allowed local origin`,
        403,
      );
    }
  }
  await next();
};
