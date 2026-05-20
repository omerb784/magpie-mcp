// S7 P4.A — server-rendered shell for `/templates` and `/templates/:id`.
//
// Same Hono server-shell + React island pattern as `/compose/:id`. The
// shell ships theme-cookie hydration, the dashboard CSS link, and a
// `<script src="/assets/templates.iife.js" defer>` that boots
// `window.MagpieTemplates.open({ id? })`. `/templates/:id` 404s when the
// template doesn't exist; `/templates` always returns the list shell.

import { Hono } from "hono";
import { getTemplate } from "../../store/send-templates.js";
import { chromeTokens } from "./chrome-tokens.js";
import { dashboardCssLinkTag } from "./dashboard-css.js";

function parseThemeCookie(cookie: string | undefined): "light" | "dark" | null {
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)magpie_theme=(light|dark)/);
  return m ? (m[1] as "light" | "dark") : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderShell(opts: { id?: string; titleText: string; theme: "light" | "dark" | null }): string {
  const themeAttr = opts.theme ? ` data-theme="${opts.theme}"` : "";
  const safeId = opts.id ? JSON.stringify(opts.id) : "null";
  const docTitle = escapeHtml(opts.titleText);
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${docTitle}</title>
<script>
  (function(){
    try {
      var root = document.documentElement;
      if (root.getAttribute('data-theme')) return;
      var m = document.cookie.match(/(?:^|;\\s*)magpie_theme=(light|dark)/);
      if (m) { root.setAttribute('data-theme', m[1]); return; }
      var s = localStorage.getItem('magpie.theme');
      if (s === 'light' || s === 'dark') { root.setAttribute('data-theme', s); return; }
      root.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch (e) {}
  })();
</script>
${dashboardCssLinkTag()}
<script src="/assets/templates.iife.js" defer></script>
<style>
${chromeTokens()}
html, body { margin: 0; padding: 0; height: 100%; background: var(--surface); color: var(--text); font-family: var(--ui-font, system-ui); }
#magpie-templates-root { position: fixed; inset: 0; }
</style>
</head>
<body>
<div id="magpie-templates-root"></div>
<script>
  (function bootTemplates(){
    function tryOpen() {
      if (window.MagpieTemplates && typeof window.MagpieTemplates.open === 'function') {
        window.MagpieTemplates.open({ id: ${safeId} });
      } else {
        setTimeout(tryOpen, 30);
      }
    }
    tryOpen();
  })();
</script>
</body>
</html>`;
}

export function mountTemplatesShellRoutes(app: Hono): void {
  app.get("/templates", (c) => {
    const theme = parseThemeCookie(c.req.header("cookie"));
    const html = renderShell({ titleText: "templates — Magpie", theme });
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(html);
  });

  app.get("/templates/:id", (c) => {
    const id = c.req.param("id");
    const t = getTemplate(id);
    if (!t) return c.text("Template not found", 404);
    const theme = parseThemeCookie(c.req.header("cookie"));
    const html = renderShell({
      id: t.id,
      titleText: `${t.name} — templates — Magpie`,
      theme,
    });
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(html);
  });
}
