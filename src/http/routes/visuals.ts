import { existsSync, readFileSync, statSync } from "node:fs";
import type { Hono } from "hono";
import { d2PreviewHtml, d2ToSvg } from "../../render/d2.js";
import { dotPreviewHtml, dotToSvg } from "../../render/dot.js";
import { enqueueRender, thumbPath } from "../../render/index.js";
import { markdownToHtml } from "../../render/markdown.js";
import { vegaLitePreviewHtml, vegaLiteToSvg } from "../../render/vegalite.js";
import { setVisualTags, tagsForVisual } from "../../store/tags.js";
import { listForVisual, setRenderStatus } from "../../store/versions.js";
import {
  archiveVisual,
  bumpCurrentVersion,
  getVisual,
  getVisualGridItem,
  listAllVisuals,
  listSiblingsInProject,
  restoreVisual,
  setVisualDescription,
  updateVisualMeta,
  type VisualType,
} from "../../store/visuals.js";
import { DESCRIPTION_MAX, getProjectById } from "../../store/projects.js";
import { extFor } from "../../store/blobs.js";
import { mimeForType, rendersToSvg } from "../../util/mime.js";
import { slugify } from "../../util/slug.js";
import { broadcast } from "../ws.js";
import { chromeTokens } from "./chrome-tokens.js";
import { dashboardCssLinkTag } from "./dashboard-css.js";
import { paneBridgeScript } from "./pane-bridge.js";
import { compareShell, deriveState, type CompareMode, type PaneRef } from "./compare-shell.js";

/**
 * Content-Security-Policy header value for visual content served at chrome=0
 * (the inner iframe body, v0.9.2 Phase B/A2).
 *
 * Decision v lean (Owner 2026-05-14, see sB-security.md): visuals are always
 * loaded inside `<iframe sandbox="allow-scripts">` (no allow-same-origin), so
 * the iframe is in a null origin and `'self'` directives evaluate to nothing
 * useful for fetch / XHR / WebSocket. The CSP is belt-and-suspenders for the
 * sandbox attribute — if a future regression weakens the sandbox, CSP still
 * blocks the request.
 *
 * Per type:
 *  - `html`: visuals may carry inline `<script>` (Claude authors them) — allow
 *    `'self' 'unsafe-inline'` for script + style. data: + blob: for img/font.
 *  - `mermaid` / `dot` / `vega-lite` / `d2`: rendered to SVG; the chrome=0
 *    body still ships a `<script type="module">` that imports the bundled
 *    mermaid runtime from `/assets/mermaid/...` — allow `'self'` + `'unsafe-inline'`
 *    for the loader. No img-src widening.
 *  - `markdown`: rendered to inert HTML (no scripts) but the pane bridge
 *    appends a `<script>` block. Allow inline script.
 *  - `svg`: native SVG response, never includes script. Tightest CSP.
 */
export function previewCsp(type: VisualType): string {
  if (type === "svg") {
    return "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  }
  if (type === "html") {
    return "default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'";
  }
  // mermaid / dot / vega-lite / d2 / markdown — internal renderers; inline
  // script for the pane bridge + module script for the mermaid loader.
  return "default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'";
}

export function mountVisualRoutes(app: Hono): void {
  app.get("/api/visuals", (c) => c.json(listAllVisuals()));

  app.get("/api/visuals/:id", (c) => {
    const v = getVisualGridItem(c.req.param("id"));
    if (!v) return c.json({ error: "not_found" }, 404);
    const versions = listForVisual(v.id).map((ver) => {
      let bytes: number | null = null;
      try {
        if (existsSync(ver.content_path)) bytes = Number(statSync(ver.content_path).size);
      } catch {
        bytes = null;
      }
      return { ...ver, bytes };
    });
    const tags = tagsForVisual(v.id);
    return c.json({ visual: v, versions, tags });
  });

  app.patch("/api/visuals/:id", async (c) => {
    const id = c.req.param("id");
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as
      | {
          title?: string;
          description?: string | null;
          tags?: string[];
          starred?: boolean;
          current_ver?: number;
        }
      | null;
    if (!body) return c.json({ error: "bad_json" }, 400);
    if (
      body.title === undefined &&
      body.description === undefined &&
      body.tags === undefined &&
      body.starred === undefined &&
      body.current_ver === undefined
    ) {
      return c.json({ error: "nothing_to_update" }, 400);
    }
    if (
      body.description !== undefined &&
      body.description !== null &&
      (typeof body.description !== "string" || body.description.length > DESCRIPTION_MAX)
    ) {
      return c.json({ error: "bad_description" }, 400);
    }
    if (body.current_ver !== undefined) {
      if (!Number.isFinite(body.current_ver) || body.current_ver < 1) {
        return c.json({ error: "bad_current_ver" }, 400);
      }
      const versions = listForVisual(v.id);
      const target = versions.find((x) => x.version_num === body.current_ver);
      if (!target) return c.json({ error: "version_not_found" }, 404);
      bumpCurrentVersion(v.id, body.current_ver);
    }
    if (body.title !== undefined || body.starred !== undefined) {
      updateVisualMeta({ visual_id: v.id, title: body.title, starred: body.starred });
    }
    if (body.description !== undefined) {
      setVisualDescription(v.id, body.description);
    }
    if (body.tags !== undefined) {
      setVisualTags(v.id, body.tags);
    }
    broadcast({ kind: "visual.updated", visual_id: v.id });
    const updated = getVisual(v.id);
    const tags = tagsForVisual(v.id);
    return c.json({ visual: updated, tags });
  });

  app.delete("/api/visuals/:id", (c) => {
    const id = c.req.param("id");
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    archiveVisual(v.id);
    broadcast({ kind: "visual.updated", visual_id: v.id });
    return c.json({ ok: true });
  });

  app.post("/api/visuals/:id/restore", (c) => {
    const id = c.req.param("id");
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    restoreVisual(v.id);
    broadcast({ kind: "visual.updated", visual_id: v.id });
    return c.json({ ok: true });
  });

  app.post("/api/visuals/:id/versions/:n/render", (c) => {
    const id = c.req.param("id");
    const n = Number(c.req.param("n"));
    if (!Number.isFinite(n) || n < 1) return c.json({ error: "bad_version" }, 400);
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    const versions = listForVisual(v.id);
    const target = versions.find((x) => x.version_num === n);
    if (!target) return c.json({ error: "version_not_found" }, 404);
    if (!existsSync(target.content_path)) {
      return c.json({ error: "content_missing_on_disk" }, 410);
    }
    setRenderStatus({
      version_id: target.id,
      status: "pending",
      thumb_path: null,
      error: null,
    });
    broadcast({ kind: "version.added", visual_id: v.id, version_num: n });
    enqueueRender({
      visual_id: v.id,
      version_id: target.id,
      version_num: n,
      type: v.type,
      content_path: target.content_path,
    });
    return c.json({ ok: true, queued: true });
  });

  app.get("/thumbs/:id/:file", (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const m = /^v(\d+)\.png$/.exec(file);
    if (!m) return c.text("bad request", 400);
    const n = Number(m[1]);
    const p = thumbPath(id, n);
    if (!existsSync(p)) {
      if (c.req.query("download") === "1") return c.text("not rendered", 404);
      c.header("Content-Type", "image/svg+xml; charset=utf-8");
      c.header("Cache-Control", "no-store");
      return c.body(thumbPlaceholderSvg());
    }
    const buf = readFileSync(p);
    c.header("Content-Type", "image/png");
    if (c.req.query("download") === "1") {
      const v = getVisual(id);
      const slug = slugify(v?.title ?? "", id);
      c.header("Content-Disposition", `attachment; filename="${slug}-v${n}.png"`);
    } else {
      c.header("Cache-Control", "public, max-age=60");
    }
    return c.body(buf);
  });

  app.get("/api/visuals/:id/source", (c) => {
    const id = c.req.param("id");
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    const versions = listForVisual(v.id);
    const verParam = c.req.query("ver");
    const verNum = verParam ? Number(verParam) : v.current_ver;
    if (!Number.isFinite(verNum) || verNum < 1) return c.json({ error: "bad_ver" }, 400);
    const target = versions.find((x) => x.version_num === verNum);
    if (!target || !existsSync(target.content_path)) {
      return c.json({ error: "content_missing" }, 404);
    }
    const buf = readFileSync(target.content_path);
    const slug = slugify(v.title ?? "", v.id);
    c.header("Content-Type", `${mimeForType(v.type)}; charset=utf-8`);
    c.header("Content-Disposition", `attachment; filename="${slug}-v${verNum}.${extFor(v.type)}"`);
    return c.body(buf);
  });

  app.get("/api/visuals/:id/render.svg", async (c) => {
    const id = c.req.param("id");
    const v = getVisual(id);
    if (!v) return c.json({ error: "not_found" }, 404);
    if (!rendersToSvg(v.type)) {
      return c.json({ error: "no_svg_for_type", type: v.type }, 415);
    }
    const versions = listForVisual(v.id);
    const verParam = c.req.query("ver");
    const verNum = verParam ? Number(verParam) : v.current_ver;
    if (!Number.isFinite(verNum) || verNum < 1) return c.json({ error: "bad_ver" }, 400);
    const target = versions.find((x) => x.version_num === verNum);
    if (!target || !existsSync(target.content_path)) {
      return c.json({ error: "content_missing" }, 404);
    }
    const content = readFileSync(target.content_path, "utf8");
    let svg: string;
    try {
      if (v.type === "svg") {
        svg = content;
      } else if (v.type === "dot") {
        svg = await dotToSvg(content);
      } else if (v.type === "vega-lite") {
        svg = await vegaLiteToSvg(content);
      } else if (v.type === "d2") {
        svg = await d2ToSvg(content);
      } else {
        return c.json({ error: "no_svg_for_type", type: v.type }, 415);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "render_failed", message: msg }, 500);
    }
    const slug = slugify(v.title ?? "", v.id);
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${slug}-v${verNum}.svg"`);
    return c.body(svg);
  });

  app.get("/v/:id", async (c) => {
    const v = getVisual(c.req.param("id"));
    if (!v) return c.text("Visual not found", 404);
    const versions = listForVisual(v.id);
    const verParam = c.req.query("ver");
    const verNum = verParam ? Number(verParam) : v.current_ver;
    if (!Number.isFinite(verNum) || verNum < 1) return c.text("bad ver", 400);
    const target = versions.find((x) => x.version_num === verNum);
    const useChrome = c.req.query("chrome") !== "0";
    const project = getProjectById(v.project_id);
    const siblings = useChrome ? listSiblingsInProject(v.project_id) : [];
    const myIdx = siblings.findIndex((s) => s.id === v.id);
    const prev = myIdx > 0 ? siblings[myIdx - 1] : null;
    const next = myIdx >= 0 && myIdx < siblings.length - 1 ? siblings[myIdx + 1] : null;
    const ctx: ChromeCtx = {
      visualId: v.id,
      title: v.title || v.id,
      type: v.type,
      version: verNum,
      currentVer: v.current_ver,
      isCurrentVer: verNum === v.current_ver,
      projectName: project?.name ?? "",
      prevId: prev?.id ?? null,
      prevTitle: prev?.title ?? null,
      nextId: next?.id ?? null,
      nextTitle: next?.title ?? null,
      position: myIdx >= 0 ? myIdx + 1 : 1,
      total: siblings.length || 1,
      archived: v.archived_at !== null,
      theme: parseThemeCookie(c.req.header("cookie")),
      siblings,
    };

    if (!target || !existsSync(target.content_path)) {
      const msg = !target
        ? `Version v${verNum} not found in the database.`
        : `Source file is missing on disk for v${verNum}. The blob may have been moved or deleted.`;
      const body = renderFailBody(msg, target?.content_path);
      if (!useChrome) return c.text(`Visual ${v.id} v${verNum} content missing on disk`, 404);
      c.header("Content-Type", "text/html; charset=utf-8");
      c.status(404);
      return c.body(previewChrome(body, ctx));
    }
    const content = readFileSync(target.content_path, "utf8");

    if (v.type === "svg") {
      if (!useChrome) {
        c.header("Content-Type", "image/svg+xml; charset=utf-8");
        c.header("Content-Security-Policy", previewCsp("svg"));
        return c.body(content);
      }
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(previewChrome(svgInlineBody(content), ctx));
    }

    const bridge = paneBridgeScript({ vid: v.id, ver: verNum });

    if (v.type === "html") {
      if (!useChrome) {
        c.header("Content-Type", "text/html; charset=utf-8");
        c.header("Content-Security-Policy", previewCsp("html"));
        return c.body(content + bridge);
      }
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(previewChrome(htmlIframeBody(v.id, verNum), ctx));
    }

    if (v.type === "mermaid") {
      if (!useChrome) c.header("Content-Security-Policy", previewCsp("mermaid"));
      const body = mermaidInlineBody(content);
      return c.html(useChrome ? previewChrome(body, ctx) : mermaidPreviewShell(content, `${v.title || v.id} v${verNum}`, ctx.theme) + bridge);
    }

    if (v.type === "markdown") {
      c.header("Content-Type", "text/html; charset=utf-8");
      if (!useChrome) {
        c.header("Content-Security-Policy", previewCsp("markdown"));
        return c.body(markdownToHtml(content) + bridge);
      }
      const { markdownToHtmlBody, getMarkdownStyles } = await import("../../render/markdown.js");
      const body = `<style>${getMarkdownStyles()}</style><style>${markdownChromeOverrides()}</style><div class="wrap">${markdownToHtmlBody(content)}</div>`;
      return c.body(previewChrome(body, ctx));
    }

    if (v.type === "dot") {
      try {
        const svg = await dotToSvg(content);
        c.header("Content-Type", "text/html; charset=utf-8");
        if (!useChrome) c.header("Content-Security-Policy", previewCsp("dot"));
        return c.body(useChrome ? previewChrome(diagramSvgBody(svg), ctx) : dotPreviewHtml(svg) + bridge);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!useChrome) return c.text(`DOT render failed: ${msg}`, 500);
        c.header("Content-Type", "text/html; charset=utf-8");
        return c.body(previewChrome(renderFailBody(msg), ctx));
      }
    }

    if (v.type === "vega-lite") {
      try {
        const svg = await vegaLiteToSvg(content);
        c.header("Content-Type", "text/html; charset=utf-8");
        if (!useChrome) c.header("Content-Security-Policy", previewCsp("vega-lite"));
        return c.body(useChrome ? previewChrome(diagramSvgBody(svg), ctx) : vegaLitePreviewHtml(svg) + bridge);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!useChrome) return c.text(`Vega-Lite render failed: ${msg}`, 500);
        c.header("Content-Type", "text/html; charset=utf-8");
        return c.body(previewChrome(renderFailBody(msg), ctx));
      }
    }

    if (v.type === "d2") {
      try {
        const svg = await d2ToSvg(content);
        c.header("Content-Type", "text/html; charset=utf-8");
        if (!useChrome) c.header("Content-Security-Policy", previewCsp("d2"));
        return c.body(useChrome ? previewChrome(diagramSvgBody(svg), ctx) : d2PreviewHtml(svg) + bridge);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!useChrome) return c.text(`D2 render failed: ${msg}`, 500);
        c.header("Content-Type", "text/html; charset=utf-8");
        return c.body(previewChrome(renderFailBody(msg), ctx));
      }
    }

    return new Response(`preview for type "${v.type}" not yet implemented`, {
      status: 501,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });

  app.get("/compare/:id", (c) => {
    const v = getVisual(c.req.param("id"));
    if (!v) return c.text("Visual not found", 404);
    const versions = listForVisual(v.id);
    const versionNums = versions.map((x) => x.version_num).sort((x, y) => x - y);

    const aRaw = c.req.query("a");
    const bRaw = c.req.query("b");
    const modeRaw = c.req.query("mode");

    const aDefault = Math.max(1, v.current_ver - 1);
    const bDefault = v.current_ver;
    const a = aRaw !== undefined ? Number(aRaw) : aDefault;
    const bIsExplicitlyEmpty = bRaw === "";
    const b = bIsExplicitlyEmpty ? null : bRaw !== undefined ? Number(bRaw) : bDefault;

    if (!Number.isFinite(a) || (b !== null && !Number.isFinite(b))) {
      return c.text("bad ver", 400);
    }
    if (!versions.find((x) => x.version_num === a)) {
      return c.text(`version ${a} not found`, 404);
    }
    if (b !== null && !versions.find((x) => x.version_num === b)) {
      return c.text(`version ${b} not found`, 404);
    }

    const mode: CompareMode = modeRaw === "overlay" ? "overlay" : "sxs";
    const aPane: PaneRef = { vid: v.id, ver: a };
    const bPane: PaneRef | null = b !== null ? { vid: v.id, ver: b } : null;
    const state = deriveState({ a: aPane, b: bPane, currentVer: v.current_ver, mode });

    const project = getProjectById(v.project_id);

    return c.html(
      compareShell({
        visualId: v.id,
        visualTitle: v.title || v.id,
        visualType: v.type,
        projectName: project?.name ?? "",
        currentVer: v.current_ver,
        versions: versionNums,
        state,
        archived: v.archived_at !== null,
        theme: parseThemeCookie(c.req.header("cookie")),
      })
    );
  });
}

interface ChromeCtx {
  visualId: string;
  title: string;
  type: VisualType;
  version: number;
  currentVer: number;
  isCurrentVer: boolean;
  projectName: string;
  prevId: string | null;
  prevTitle: string | null;
  nextId: string | null;
  nextTitle: string | null;
  position: number;
  total: number;
  archived: boolean;
  theme: "light" | "dark" | null;
  siblings: { id: string; title: string; type: VisualType; current_ver: number }[];
}

function parseThemeCookie(cookieHeader: string | undefined): "light" | "dark" | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "magpie_theme" && (v === "light" || v === "dark")) return v;
  }
  return null;
}

function previewChrome(body: string, ctx: ChromeCtx): string {
  const t = escapeHtml(ctx.title);
  const p = escapeHtml(ctx.projectName);
  const idEnc = encodeURIComponent(ctx.visualId);
  const verSuffix = ctx.isCurrentVer ? "" : `?ver=${ctx.version}`;
  const prevHref = ctx.prevId ? `/v/${encodeURIComponent(ctx.prevId)}` : "";
  const nextHref = ctx.nextId ? `/v/${encodeURIComponent(ctx.nextId)}` : "";
  const prevTitle = ctx.prevTitle ? escapeHtml(ctx.prevTitle) : "";
  const nextTitle = ctx.nextTitle ? escapeHtml(ctx.nextTitle) : "";
  const currentHref = `/v/${idEnc}`;
  const compareHref = `/compare/${idEnc}?a=${ctx.version}&b=${ctx.currentVer}`;
  const compareDefaultHref = `/compare/${idEnc}?a=${Math.max(1, ctx.currentVer - 1)}&b=${ctx.currentVer}`;
  const canCompare = ctx.currentVer >= 2;
  const sourceHref = `/api/visuals/${idEnc}/source?ver=${ctx.version}`;
  const dashHref = `/?visual=${idEnc}`;
  const themeAttr = ctx.theme ? ` data-theme="${ctx.theme}"` : "";
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${t}${ctx.isCurrentVer ? "" : ` v${ctx.version}`} — Magpie</title>
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
<script src="/assets/send-modal.iife.js" defer></script>
<style>
  ${chromeTokens()}
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--ui-font); }
  body { display: flex; flex-direction: column; }
  a { color: inherit; text-decoration: none; }

  .chrome { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 0 12px; height: 44px; background: var(--chrome-bg); border-bottom: 1px solid var(--hr); backdrop-filter: blur(12px) saturate(1.4); -webkit-backdrop-filter: blur(12px) saturate(1.4); position: sticky; top: 0; z-index: 10; }

  .nav-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; height: 28px; min-width: 28px; border-radius: 7px; font-size: 12px; color: var(--text-mute); background: var(--surface); border: 1px solid var(--hr); transition: background 120ms, color 120ms, border-color 120ms; justify-content: center; cursor: pointer; }
  .nav-btn:hover { background: var(--surface-2); color: var(--text); border-color: var(--hr-strong); }
  .nav-btn.disabled { opacity: 0.42; pointer-events: none; }
  .nav-btn .ico { font-size: 13px; line-height: 1; }
  .nav-btn .label { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; transition: max-width 200ms, padding 200ms; padding: 0; }
  .nav-btn:hover .label { max-width: 22ch; padding: 0 4px; }

  .pos { font-family: var(--mono-font); font-size: 11px; color: var(--text-mute); font-variant-numeric: tabular-nums; padding: 0 6px; height: 28px; display: inline-flex; align-items: center; }

  .crumb { font-size: 12.5px; color: var(--text-mute); display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; overflow: hidden; }
  .crumb .proj { color: var(--text-mute); padding: 3px 6px; margin: -3px 0; border-radius: 5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background 100ms, color 100ms; cursor: pointer; }
  .crumb .proj:hover { color: var(--text); background: var(--surface-2); }
  .crumb .sep { color: var(--text-subtle); opacity: 0.6; user-select: none; }
  .crumb .ttl { color: var(--text); font-weight: 500; font-size: 13px; max-width: 36ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ver-pill { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 999px; font-family: var(--mono-font); font-size: 10.5px; font-weight: 500; letter-spacing: 0.04em; border: 1px solid var(--hr-strong); background: var(--surface-2); color: var(--text-mute); flex-shrink: 0; }
  .ver-pill.current { background: var(--accent); color: #ffffff; border-color: var(--accent-deep); }
  .ver-pill.old { background: transparent; color: var(--text-mute); border-color: var(--hr-strong); }

  .type-pill { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; font-family: var(--mono-font); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; background: transparent; border: 1px solid var(--hr); color: var(--text-subtle); flex-shrink: 0; }

  .actions { display: inline-flex; gap: 4px; align-items: center; flex-shrink: 0; }
  .action-btn { height: 28px; padding: 0 10px; border: 1px solid transparent; background: transparent; border-radius: 7px; color: var(--text-mute); font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; text-decoration: none; }
  .action-btn:hover { color: var(--text); background: var(--surface-2); }
  .action-btn.primary { border-color: var(--hr-strong); background: var(--surface); color: var(--text); }
  .action-btn.primary:hover { border-color: var(--text); }
  .action-btn.icon { padding: 0; width: 28px; justify-content: center; font-size: 14px; }
  .action-btn.send-btn { background: linear-gradient(95deg, #c25d3a, #a89455 60%, #5a8a52); color: #ffffff; border-color: rgba(20, 20, 19, 0.18); font-weight: 500; transition: filter 120ms; }
  .action-btn.send-btn:hover { filter: brightness(1.05); color: #ffffff; border-color: rgba(20, 20, 19, 0.18); background: linear-gradient(95deg, #c25d3a, #a89455 60%, #5a8a52); }
  body[data-workbench="open"] .action-btn.send-btn { display: none; }
  .send-glyph { display: inline-flex; width: 12px; height: 12px; align-items: center; justify-content: center; }
  .send-glyph svg { width: 12px; height: 12px; display: block; }

  .more-menu { position: relative; }
  .more-menu summary { list-style: none; cursor: pointer; }
  .more-menu summary::-webkit-details-marker { display: none; }
  .more-pop { position: absolute; right: 0; top: calc(100% + 6px); min-width: 220px; background: var(--surface); border: 1px solid var(--hr-strong); border-radius: 10px; box-shadow: var(--shadow); padding: 4px; z-index: 20; }
  .more-pop a, .more-pop button { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; font: inherit; font-size: 12.5px; color: var(--text); border: 0; background: transparent; width: 100%; text-align: left; cursor: pointer; }
  .more-pop a:hover, .more-pop button:hover { background: var(--surface-2); }
  .more-pop hr { border: 0; border-top: 1px solid var(--hr); margin: 4px 0; }
  .more-pop .danger { color: var(--rose); }

  .archive-banner { flex: 0 0 auto; height: 34px; background: var(--surface-2); border-bottom: 1px solid var(--hr); display: flex; align-items: center; padding: 0 14px; gap: 10px; font-size: 12px; color: var(--text-mute); }
  .archive-banner b { color: var(--text); font-weight: 500; }
  .archive-banner .tag { font-family: var(--serif-font); font-style: italic; color: var(--text-subtle); }
  .archive-banner .restore { margin-left: auto; color: var(--accent-deep); background: transparent; border: 0; cursor: pointer; font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 5px; }
  .archive-banner .restore:hover { background: var(--accent-soft); }

  .historical-strip { flex: 0 0 auto; height: 32px; background: var(--accent-soft); border-bottom: 1px solid var(--hr); display: flex; align-items: center; padding: 0 14px; gap: 6px; font-family: var(--mono-font); font-size: 11.5px; color: var(--text-mute); }
  .historical-strip b { color: var(--text); font-weight: 500; }
  .historical-strip .right { margin-left: auto; }
  .historical-strip .right a { color: var(--accent-deep); cursor: pointer; }

  .body-grid { position: relative; flex: 1 1 auto; min-height: 0; display: grid;
    grid-template-columns: 256px 1fr;
    transition: grid-template-columns var(--dur-med) var(--ease-soft); }
  .body-grid.sidebar-hidden { grid-template-columns: 0px 1fr; }
  .body-grid > .preview-sidebar { grid-column: 1; }
  .body-grid > .stage { grid-column: 2; }

  .stage { min-width: 0; min-height: 0; overflow: auto; background: var(--surface); position: relative; }
  .stage > .wrap { display: block; }
  .stage > iframe { width: 100%; height: 100%; border: 0; display: block; background: var(--surface); }
  .stage > .svg-host { display: flex; align-items: center; justify-content: center; padding: 32px; min-height: 100%; }
  .stage > .svg-host > svg, .stage > .svg-host > img { max-width: 100%; max-height: 100%; height: auto; display: block; }
  .stage > .diagram-host { display: flex; align-items: center; justify-content: center; padding: 24px; min-height: 100%; background: var(--surface); }
  .stage > .diagram-host > svg { max-width: 100%; height: auto; display: block; }

  .preview-sidebar { border-right: 1px solid var(--hr); background: var(--surface);
    min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
  .body-grid.sidebar-hidden .preview-sidebar { border-right: 0; visibility: hidden; }
  .psb-head { display: flex; align-items: center; padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--hr); gap: var(--s-2); }
  .psb-head .lbl { font-family: var(--mono-font); font-size: var(--fs-2xs);
    letter-spacing: var(--tracking-mono); text-transform: uppercase;
    color: var(--text-mute); flex: 1 1 auto; }
  .psb-head .count { font-family: var(--mono-font); font-size: var(--fs-2xs);
    color: var(--text-subtle); font-variant-numeric: tabular-nums; }
  .psb-head .collapse { background: transparent; border: 0; cursor: pointer;
    color: var(--text-subtle); padding: 2px 4px; border-radius: var(--radius-sm);
    font: inherit; font-size: 12px; }
  .psb-head .collapse:hover { color: var(--text); background: var(--surface-2); }
  .psb-list { flex: 1 1 auto; overflow: auto; padding: var(--s-2);
    display: flex; flex-direction: column; gap: 1px; }
  .psb-row { display: grid; grid-template-columns: 32px 1fr auto;
    gap: var(--s-2); padding: var(--s-2);
    border-radius: var(--radius-md); cursor: pointer; align-items: center;
    text-decoration: none; color: var(--text);
    transition: background var(--dur-fast); }
  .psb-row:hover { background: var(--surface-2); }
  .psb-row.active { background: var(--accent-soft); position: relative; }
  .psb-row.active::before { content: ""; position: absolute; left: -1px; top: 7px;
    width: 3px; height: 22px; background: var(--accent); border-radius: 0 2px 2px 0; }
  .psb-row .thumb { width: 32px; height: 32px; border-radius: var(--radius-sm);
    background: var(--thumb-bg); border: 1px solid var(--hr);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    font-family: var(--mono-font); font-size: 8px;
    color: var(--text-subtle); letter-spacing: 0.06em; text-transform: uppercase;
    overflow: hidden; position: relative; }
  .psb-row .thumb .stripe { position: absolute; left: 0; right: 0; bottom: 0;
    height: 2px; background: var(--fmt-html); opacity: 0.55; }
  .psb-row .thumb.fmt-mermaid .stripe { background: var(--fmt-mermaid); }
  .psb-row .thumb.fmt-svg .stripe { background: var(--fmt-svg); }
  .psb-row .thumb.fmt-markdown .stripe { background: var(--fmt-markdown); }
  .psb-row .thumb.fmt-dot .stripe { background: var(--fmt-dot); }
  .psb-row .thumb.fmt-d2 .stripe { background: var(--fmt-d2); }
  .psb-row .thumb.fmt-vega-lite .stripe { background: var(--fmt-vega-lite); }
  .psb-row .ttl { font-size: var(--fs-sm); color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    line-height: var(--lh-snug); }
  .psb-row .meta { font-family: var(--mono-font); font-size: var(--fs-2xs);
    color: var(--text-subtle); letter-spacing: 0.04em; white-space: nowrap; }
  .psb-row.active .ttl { color: var(--text); font-weight: 500; }
  .psb-row.active .meta { color: var(--accent-deep); }
  :root[data-theme="dark"] .psb-row.active .meta { color: var(--accent); }
  :root[data-theme="dark"] .psb-row.active::before { background: var(--accent); }
  .psb-foot { border-top: 1px solid var(--hr); padding: var(--s-2) var(--s-3);
    font-family: var(--serif-font); font-style: italic;
    font-size: var(--fs-xs); color: var(--text-subtle); }
  .psb-foot kbd { font-family: var(--mono-font); font-style: normal;
    font-size: 9.5px; padding: 1px 4px;
    background: var(--surface-2); border: 1px solid var(--hr);
    border-bottom-width: 2px; border-radius: 3px; color: var(--text-mute); margin: 0 2px; }

  .sidebar-tab { position: absolute; top: 50%; left: 0; transform: translateY(-50%);
    width: 26px; height: 72px;
    background: var(--surface-2); border: 1px solid var(--hr-strong);
    border-left: 0; border-radius: 0 var(--radius-md) var(--radius-md) 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--text); cursor: pointer;
    font-size: 16px; font-family: var(--mono-font); line-height: 1;
    box-shadow: var(--shadow-lift);
    transition: color var(--dur-fast), background var(--dur-fast), border-color var(--dur-fast), width var(--dur-fast), box-shadow var(--dur-fast);
    z-index: 6; }
  .sidebar-tab:hover { color: #ffffff; background: var(--accent); border-color: var(--accent-deep); width: 30px; box-shadow: var(--shadow-pop); }
  :root[data-theme="dark"] .sidebar-tab { background: var(--surface-2); border-color: var(--hr-strong); color: var(--text); box-shadow: var(--shadow-lift-d); }
  :root[data-theme="dark"] .sidebar-tab:hover { background: var(--accent); border-color: var(--accent-deep); color: #ffffff; box-shadow: var(--shadow-pop-d); }
  .body-grid:not(.sidebar-hidden) .sidebar-tab { display: none; }

  .error-card { margin: auto; max-width: 460px; padding: 24px; border: 1px dashed var(--hr-strong); border-radius: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; color: var(--text); }
  .error-card .head { display: flex; align-items: center; gap: 10px; }
  .error-card .ico { width: 28px; height: 28px; border-radius: 7px; background: rgba(194,95,95,0.15); color: var(--rose); display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; flex-shrink: 0; }
  .error-card h4 { margin: 0; font-size: 14px; font-weight: 500; }
  .error-card p { margin: 0; font-size: 12.5px; color: var(--text-mute); }
  .error-card pre { margin: 0; padding: 10px 12px; background: var(--surface-2); border-radius: 7px; font-family: var(--mono-font); font-size: 11px; color: var(--text-mute); overflow-x: auto; white-space: pre-wrap; }
  .error-card .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .error-card .row a, .error-card .row button { height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--hr-strong); background: var(--surface); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
  .error-card .row .primary { background: var(--accent); color: #ffffff; border-color: var(--accent-deep); }
  .error-stage { display: flex; padding: 24px; min-height: 100%; }

  @media (max-width: 720px) {
    .crumb .proj, .crumb .ttl { max-width: 80px; }
    .nav-btn .label, .nav-btn:hover .label { display: none; }
    .body-grid { grid-template-columns: 0px 1fr; }
    .preview-sidebar { visibility: hidden; }
  }
</style>
</head>
<body data-prev="${prevHref}" data-next="${nextHref}">
<header class="chrome">
  ${
    ctx.prevId
      ? `<a class="nav-btn" href="${prevHref}" title="Previous: ${prevTitle}" data-nav="prev"><span class="ico">‹</span><span class="label">${prevTitle}</span></a>`
      : `<span class="nav-btn disabled" aria-disabled="true"><span class="ico">‹</span></span>`
  }
  <span class="pos">${ctx.position} / ${ctx.total}</span>
  ${
    ctx.nextId
      ? `<a class="nav-btn" href="${nextHref}" title="Next: ${nextTitle}" data-nav="next"><span class="label">${nextTitle}</span><span class="ico">›</span></a>`
      : `<span class="nav-btn disabled" aria-disabled="true"><span class="ico">›</span></span>`
  }
  <span class="crumb">
    ${p ? `<a class="proj" href="/" title="Open dashboard">${p}</a><span class="sep">/</span>` : ""}
    <span class="ttl">${t}</span>
    <span class="ver-pill ${ctx.isCurrentVer ? "current" : "old"}">v${ctx.version}${ctx.currentVer > 1 ? ` of ${ctx.currentVer}` : ""}</span>
    <span class="type-pill">${ctx.type}</span>
  </span>
  <div class="actions">
    ${ctx.isCurrentVer ? "" : `<a class="action-btn" href="${compareHref}" title="Compare this version to current">⇆ Compare to current</a>`}
    ${canCompare && ctx.isCurrentVer ? `<a class="action-btn" href="${compareDefaultHref}" title="Compare current to previous version" data-compare>⇆ Compare</a>` : ""}
    <button class="action-btn primary send-btn" data-send-modal title="Talk with agent (s)">
      <span class="send-glyph"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1L5 7"/><path d="M11 1L8 11l-2-4-4-2z"/></svg></span>
      <span>Talk with agent</span>
    </button>
    <details class="more-menu">
      <summary class="action-btn icon" title="More">⋯</summary>
      <div class="more-pop">
        <a href="${currentHref}">Open current version</a>
        <a href="${dashHref}">Open in dashboard</a>
        <button data-copy-link>Copy link</button>
        <a href="${sourceHref}">Download source</a>
        <hr/>
        <a class="danger" href="${dashHref}" title="Open this visual in the dashboard for tagging, archiving, and rendering">Manage in dashboard</a>
      </div>
    </details>
  </div>
</header>
${ctx.archived ? `<div class="archive-banner"><b>Archived.</b> <span class="tag">hidden from default lists</span> <span>Compare and link still work.</span> <a class="restore" href="${dashHref}">↺ Restore in dashboard</a></div>` : ""}
${!ctx.isCurrentVer ? `<div class="historical-strip">You're viewing <b>v${ctx.version}</b> of <b>${ctx.currentVer}</b>. Current is <b>v${ctx.currentVer}</b>.<span class="right"><a href="${currentHref}">Open current →</a></span></div>` : ""}
<div class="body-grid" id="body-grid">
  ${previewSidebar(ctx)}
  <div class="stage">${body}</div>
  <button class="sidebar-tab" id="sidebar-tab" title="Show sibling visuals (b)" aria-label="Show sibling visuals">›</button>
</div>
<script>
(function () {
  var prev = document.body.dataset.prev || "";
  var next = document.body.dataset.next || "";
  function go(href) { if (href) window.location.href = href; }
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(prev); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(next); }
  });
  var grid = document.getElementById("body-grid");
  var tab = document.getElementById("sidebar-tab");
  function applySidebarState(state) {
    if (!grid) return;
    if (state === "hidden") grid.classList.add("sidebar-hidden");
    else grid.classList.remove("sidebar-hidden");
    try { localStorage.setItem("magpie.previewSidebar", state); } catch (_) {}
  }
  try {
    var saved = localStorage.getItem("magpie.previewSidebar");
    if (saved === "hidden") applySidebarState("hidden");
  } catch (_) {}
  function toggleSidebar() {
    if (!grid) return;
    applySidebarState(grid.classList.contains("sidebar-hidden") ? "expanded" : "hidden");
  }
  if (tab) tab.addEventListener("click", toggleSidebar);
  document.querySelectorAll("[data-sidebar-collapse]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); applySidebarState("hidden"); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "b" || e.key === "B") { e.preventDefault(); toggleSidebar(); }
  });

  document.querySelectorAll("[data-copy-link]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      try { navigator.clipboard.writeText(window.location.href); } catch (_) {}
      var orig = el.textContent;
      el.textContent = "Copied";
      setTimeout(function () { el.textContent = orig; }, 1100);
    });
  });

  function openSendModal() {
    if (!window.MagpieSendModal) return;
    window.MagpieSendModal.open({
      visualId: ${JSON.stringify(ctx.visualId)},
      currentVer: ${ctx.currentVer},
      versionShown: ${ctx.version},
      verSources: ${
        ctx.isCurrentVer
          ? "undefined"
          : JSON.stringify([
              { key: "current", label: `current (v${ctx.currentVer})`, ver: ctx.currentVer, tone: "current" },
              { key: "showing", label: `showing (v${ctx.version})`, ver: ctx.version },
            ])
      }
    });
  }
  document.querySelectorAll("[data-send-modal]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); openSendModal(); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "s" || e.key === "S") { e.preventDefault(); openSendModal(); }
  });
  document.addEventListener("click", function (e) {
    document.querySelectorAll("details.more-menu[open]").forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute("open");
    });
  });
})();
</script>
</body>
</html>`;
}

function previewSidebar(ctx: ChromeCtx): string {
  const rows = ctx.siblings
    .map((s) => {
      const isActive = s.id === ctx.visualId;
      const href = `/v/${encodeURIComponent(s.id)}`;
      const ttl = escapeHtml(s.title || s.id);
      const fmt = `fmt-${s.type}`;
      const initial = (s.title || s.id).slice(0, 2).toUpperCase();
      return `<a class="psb-row${isActive ? " active" : ""}" href="${href}" data-sibling="${encodeURIComponent(s.id)}">
        <span class="thumb ${fmt}">${escapeHtml(initial)}<span class="stripe"></span></span>
        <span class="ttl">${ttl}</span>
        <span class="meta">v${s.current_ver}</span>
      </a>`;
    })
    .join("");
  return `<aside class="preview-sidebar" id="preview-sidebar" aria-label="Sibling visuals in this project">
    <div class="psb-head">
      <span class="lbl">In this project</span>
      <span class="count">${ctx.siblings.length}</span>
      <button class="collapse" data-sidebar-collapse title="Hide sidebar (b)" aria-label="Hide sidebar">‹</button>
    </div>
    <div class="psb-list">${rows}</div>
    <div class="psb-foot">press <kbd>b</kbd> to toggle · <kbd>←</kbd> <kbd>→</kbd> to step</div>
  </aside>`;
}

function thumbPlaceholderSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet" role="img" aria-label="No thumbnail yet">
  <rect width="320" height="200" fill="#f4f1ea" />
  <g fill="none" stroke="#d6cfc1" stroke-width="1.5">
    <rect x="0.75" y="0.75" width="318.5" height="198.5" rx="6" />
  </g>
  <g transform="translate(160 92)" fill="#a8a097" font-family="ui-monospace, 'SF Mono', Menlo, monospace" text-anchor="middle">
    <circle cx="0" cy="-18" r="13" fill="none" stroke="#cdc4b3" stroke-width="2" />
    <line x1="-9" y1="-27" x2="9" y2="-9" stroke="#cdc4b3" stroke-width="2" stroke-linecap="round" />
    <text y="18" font-size="11" letter-spacing="0.08em">NO THUMBNAIL</text>
    <text y="34" font-size="9" letter-spacing="0.06em" fill="#bcb3a3">re-render to refresh</text>
  </g>
</svg>`;
}

function renderFailBody(message: string, context?: string): string {
  const m = escapeHtml(message);
  const ctxBlock = context ? `<pre>${escapeHtml(context)}</pre>` : "";
  return `<div class="error-stage"><div class="error-card">
    <div class="head"><span class="ico">!</span><h4>Render failed</h4></div>
    <p>${m}</p>
    ${ctxBlock}
    <div class="row">
      <button class="primary" onclick="location.reload()">↻ Retry</button>
      <a href="?chrome=0">View source</a>
      <a href="/">Open dashboard</a>
    </div>
  </div></div>`;
}

function markdownChromeOverrides(): string {
  const lightVars = `--md-bg:var(--surface);--md-fg:var(--text);--md-muted:var(--text-mute);--md-border:var(--hr-strong);--md-border-soft:var(--hr);--md-link:var(--accent-deep);--md-code-bg:var(--surface-2);--md-code-fg:var(--text);--md-block-bg:var(--surface-2);--md-accent:var(--accent);`;
  const darkLink = `--md-link:var(--accent);`;
  return `:root,html,body{background:var(--surface);color:var(--text);}
.wrap{background:var(--surface);color:var(--text);}
:root[data-theme="light"]{${lightVars}}
:root[data-theme="dark"]{${lightVars}${darkLink}}`;
}

function svgInlineBody(svg: string): string {
  return `<div class="svg-host">${svg}</div>`;
}

function diagramSvgBody(svg: string): string {
  return `<div class="diagram-host">${svg}</div>`;
}

function htmlIframeBody(visualId: string, ver: number): string {
  return `<iframe src="/v/${encodeURIComponent(visualId)}?ver=${ver}&chrome=0" sandbox="allow-scripts"></iframe>`;
}

function mermaidInlineBody(source: string): string {
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<div class="diagram-host"><pre class="mermaid" style="background:transparent;border:0;padding:0;margin:0;width:100%">${escaped}</pre></div>
<script type="module">
  import mermaid from "/assets/mermaid/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default" });
  await mermaid.run({ querySelector: "pre.mermaid" });
</script>`;
}

function mermaidPreviewShell(source: string, title: string, theme: "light" | "dark" | null): string {
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const themeAttr = theme ? ` data-theme="${theme}"` : "";
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — Magpie preview</title>
<script>
  (function(){
    try {
      var root = document.documentElement;
      if (root.getAttribute('data-theme')) return;
      var m = document.cookie.match(/(?:^|;\\s*)magpie_theme=(light|dark)/);
      if (m) { root.setAttribute('data-theme', m[1]); return; }
      root.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch (e) {}
  })();
</script>
<style>
  :root { --bg: #eef0f4; --fg: #0e0f14; --pre-bg: #f7f8fb; --pre-border: rgba(14,15,20,0.18); --muted: #5a5e6d; }
  :root[data-theme="dark"] { --bg: #0c0e16; --fg: #eef0f4; --pre-bg: #141826; --pre-border: rgba(238,240,244,0.20); --muted: #a3a8bb; }
  html,body { margin:0; background:var(--bg); color:var(--fg); font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  pre.mermaid { background:var(--pre-bg); border:1px solid var(--pre-border); border-radius:8px; padding:24px; }
  pre.mermaid svg { max-width:100%; height:auto; display:block; margin:0 auto; }
  h1 { font-size:14px; color:var(--muted); margin:0 0 12px; letter-spacing:0.04em; text-transform:uppercase; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(title)}</h1>
  <pre class="mermaid">${escaped}</pre>
</div>
<script type="module">
  import mermaid from "/assets/mermaid/mermaid.esm.min.mjs";
  var t = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
  mermaid.initialize({ startOnLoad: false, theme: t });
  await mermaid.run({ querySelector: "pre.mermaid" });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type { VisualType };
