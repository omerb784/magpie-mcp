import { chromeTokens } from "./chrome-tokens.js";
import { dashboardCssLinkTag } from "./dashboard-css.js";

// Unified compare shell — `/compare/:id` route body.
//
// State machine (see deriveState):
//   single          — only one pane requested (b empty); falls through to standalone /v/:id
//                     visually but stays on /compare/:id route for URL stability.
//   comparable      — both panes valid + distinct.
//   not-comparable  — same-version (`a-equals-b`) or only-one-version-exists (`v1-only`).
//                     `type-mismatch` is reserved for future cross-visual compare.
//
// Pane wiring:
//   each pane = <iframe src="/v/:id?ver=N&chrome=0" sandbox="allow-scripts">.
//   sandbox drops allow-same-origin (G-120 / G-121); pane-bridge.ts owns coordination.

export type CompareMode = "sxs" | "overlay";

export interface PaneRef {
  vid: string;
  ver: number;
}

export type NotComparableReason = "v1-only" | "a-equals-b" | "type-mismatch";

export type ShellState =
  | { kind: "single"; pane: PaneRef }
  | { kind: "comparable"; a: PaneRef; b: PaneRef; mode: CompareMode }
  | { kind: "not-comparable"; a: PaneRef; b: PaneRef; reason: NotComparableReason };

export interface DeriveStateInput {
  a: PaneRef;
  b: PaneRef | null;
  currentVer: number;
  mode: CompareMode;
}

export function deriveState(input: DeriveStateInput): ShellState {
  if (!input.b) {
    return { kind: "single", pane: input.a };
  }
  if (input.a.vid === input.b.vid && input.a.ver === input.b.ver) {
    const reason: NotComparableReason = input.currentVer <= 1 ? "v1-only" : "a-equals-b";
    return { kind: "not-comparable", a: input.a, b: input.b, reason };
  }
  return { kind: "comparable", a: input.a, b: input.b, mode: input.mode };
}

export interface CompareShellArgs {
  visualId: string;
  visualTitle: string;
  visualType: string;
  projectName: string;
  currentVer: number;
  versions: number[];
  state: ShellState;
  archived: boolean;
  theme: "light" | "dark" | null;
}

export function compareShell(args: CompareShellArgs): string {
  const { state } = args;
  const t = escapeHtml(args.visualTitle);
  const p = escapeHtml(args.projectName);
  const idEnc = encodeURIComponent(args.visualId);
  const themeAttr = args.theme ? ` data-theme="${args.theme}"` : "";
  const dashHref = `/?visual=${idEnc}`;
  const aVer = state.kind === "single" ? state.pane.ver : state.a.ver;
  const bVer = state.kind === "single" ? null : state.b.ver;
  const mode: CompareMode = state.kind === "comparable" ? state.mode : "sxs";
  const versionsJson = JSON.stringify(args.versions);

  const titleSuffix =
    state.kind === "comparable"
      ? ` — compare v${state.a.ver} ↔ v${state.b.ver}`
      : state.kind === "not-comparable"
      ? ` — compare (${state.reason})`
      : ` — v${aVer}`;

  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${t}${titleSuffix} — Magpie</title>
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
${shellStyles()}
</style>
</head>
<body data-vid="${args.visualId}" data-current="${args.currentVer}" data-mode="${mode}">
<header class="chrome">
  <a class="back-btn" href="${dashHref}" title="Back to dashboard" aria-label="Back to dashboard">
    <span class="ico">‹</span><span class="lbl">back</span>
  </a>
  <span class="crumb">
    ${p ? `<span class="proj">${p}</span><span class="sep">/</span>` : ""}
    <span class="ttl">${t}</span>
    <span class="type-pill">${escapeHtml(args.visualType)}</span>
  </span>

  <div class="pickers">
    ${pickerHtml("a", aVer, args.versions, args.currentVer)}
    <button class="swap" data-swap title="Swap A ↔ B">⇆</button>
    ${pickerHtml("b", bVer, args.versions, args.currentVer)}
  </div>

  <div class="modes" role="radiogroup" aria-label="Compare mode">
    <button class="mode ${mode === "sxs" ? "on" : ""}" data-mode="sxs">sxs</button>
    <button class="mode ${mode === "overlay" ? "on" : ""}" data-mode="overlay">overlay</button>
  </div>

  <button class="send-btn" data-send-modal title="Talk with agent (s)">
    <span class="send-glyph"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1L5 7"/><path d="M11 1L8 11l-2-4-4-2z"/></svg></span>
    <span>Talk with agent</span>
  </button>
</header>

${args.archived ? `<div class="archive-banner"><b>Archived.</b> <span class="tag">hidden from default lists</span> <span>Compare and link still work.</span> <a class="restore" href="${dashHref}">↺ Restore in dashboard</a></div>` : ""}

<div class="stage state-${state.kind}" data-mode="${mode}">
${stageBody(args, state)}
</div>

<script>
${shellScript(versionsJson, args.currentVer, aVer, bVer)}
</script>
</body>
</html>`;
}

function pickerHtml(
  side: "a" | "b",
  ver: number | null,
  versions: number[],
  currentVer: number
): string {
  const empty = ver === null;
  if (empty) {
    return `<button class="vchip empty" data-add="b" title="Add pane B">+ pane B</button>`;
  }
  const opts = versions
    .map((n) => `<option value="${n}"${ver === n ? " selected" : ""}>v${n}${n === currentVer ? " · current" : ""}</option>`)
    .join("");
  const isCur = ver === currentVer;
  const removeBtn =
    side === "b"
      ? `<button class="vchip-remove" data-remove="b" title="Remove pane B" aria-label="Remove pane B">×</button>`
      : "";
  return `<label class="vchip ${side}">
    <span class="side">${side.toUpperCase()}</span>
    <span class="ver">v${ver}</span>
    ${isCur ? `<span class="cur" title="current"></span>` : ""}
    <span class="caret">▼</span>
    <select name="pane-${side}-ver" data-picker="${side}-ver" aria-label="Pane ${side.toUpperCase()} version">${opts}</select>
    ${removeBtn}
  </label>`;
}

function stageBody(args: CompareShellArgs, state: ShellState): string {
  if (state.kind === "single") {
    return `<div class="pane pane-only">
      ${paneIframe(args.visualId, state.pane.ver, "·", args.currentVer)}
    </div>`;
  }
  if (state.kind === "not-comparable") {
    return notComparableCard(args, state);
  }
  return `<div class="pane pane-a">
    ${paneIframe(args.visualId, state.a.ver, "a", args.currentVer)}
  </div>
  <div class="pane pane-b">
    ${paneIframe(args.visualId, state.b.ver, "b", args.currentVer)}
  </div>
  ${state.mode === "overlay" ? overlaySliderHtml() : ""}`;
}

function paneIframe(vid: string, ver: number, side: "a" | "b" | "·", currentVer: number): string {
  const idEnc = encodeURIComponent(vid);
  const previewHref = ver === currentVer ? `/v/${idEnc}` : `/v/${idEnc}?ver=${ver}`;
  const sourceHref = `/api/visuals/${idEnc}/source?ver=${ver}`;
  const isCurrent = ver === currentVer;
  return `<div class="pane-label">
  <span class="side">${side === "·" ? "·" : side.toUpperCase()}</span>
  <span class="ver">v${ver}</span>
  ${isCurrent ? `<span class="cur-tag">current</span>` : ""}
  <span class="pane-actions">
    <a class="pane-action primary" href="${previewHref}" title="Open v${ver} at full preview" aria-label="Open v${ver} at full preview" data-pane-jump="${ver}">↗</a>
    <details class="pane-menu">
      <summary class="pane-action" title="More" aria-label="More pane actions">⋯</summary>
      <div class="pop">
        <a href="${previewHref}">↗ Open v${ver} at full preview</a>
        <button type="button" data-copy-pane-link="${ver}">⎘ Copy link to v${ver}</button>
        <a href="${sourceHref}">↓ Download source</a>
      </div>
    </details>
  </span>
</div>
<iframe src="/v/${idEnc}?ver=${ver}&chrome=0" sandbox="allow-scripts" data-pane data-ver="${ver}"></iframe>`;
}

function overlaySliderHtml(): string {
  return `<div class="overlay-control">
    <span class="overlay-label">A</span>
    <input type="range" min="0" max="100" value="50" data-overlay />
    <span class="overlay-label">B</span>
  </div>`;
}

function notComparableCard(args: CompareShellArgs, state: { reason: NotComparableReason; a: PaneRef; b: PaneRef }): string {
  const idEnc = encodeURIComponent(args.visualId);
  if (state.reason === "v1-only") {
    return `<div class="empty-card">
      <div class="glyph">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 14c2-4 5-6 7-6s5 2 7 6"/>
          <path d="M5 14h14"/>
          <path d="M7 14v3a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-3"/>
        </svg>
      </div>
      <span class="tag">a single version, no shadow yet</span>
      <h3>Only one version exists yet</h3>
      <p>This visual has v1 only. Iterate it from Claude (<code>iterate(visual_id, ...)</code>) to create v2, then come back to compare.</p>
      <div class="empty-row">
        <a class="empty-btn primary" href="/v/${idEnc}">Open v1 →</a>
      </div>
    </div>`;
  }
  if (state.reason === "a-equals-b") {
    const altA = state.a.ver - 1 >= 1 ? state.a.ver - 1 : args.currentVer;
    return `<div class="empty-card">
      <div class="glyph subtle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M5 9h14"/><path d="M5 15h14"/>
        </svg>
      </div>
      <span class="tag">the same version twice</span>
      <h3>Same version on both sides</h3>
      <p>You picked v${state.a.ver} on both panes. Pick a different version on one side, or jump to the standard prev↔current diff.</p>
      <div class="empty-row">
        <a class="empty-btn" href="?a=${altA}&b=${state.b.ver}">A → v${altA}</a>
        <a class="empty-btn primary" href="?a=${Math.max(1, args.currentVer - 1)}&b=${args.currentVer}">prev ↔ current</a>
      </div>
    </div>`;
  }
  return `<div class="empty-card">
    <div class="glyph subtle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
      </svg>
    </div>
    <span class="tag">incompatible visual types</span>
    <h3>Type mismatch</h3>
    <p>Cross-visual compare requires both panes to share a renderable type.</p>
  </div>`;
}

function shellStyles(): string {
  return `${chromeTokens()}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--ui-font); }
body { display: flex; flex-direction: column; }
a { color: inherit; text-decoration: none; }

.chrome { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 50px;
  background: var(--chrome-bg); border-bottom: 1px solid var(--hr);
  backdrop-filter: blur(12px) saturate(1.4); -webkit-backdrop-filter: blur(12px) saturate(1.4);
  position: sticky; top: 0; z-index: 10; }
.back-btn { display: inline-flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 var(--s-2);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm); color: var(--text-mute);
  background: transparent; border: 1px solid transparent;
  transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
  flex-shrink: 0; }
.back-btn:hover { background: var(--surface-2); color: var(--text); border-color: var(--hr); }
.back-btn .ico { font-size: 14px; line-height: 1; }
.back-btn .lbl { font-size: var(--fs-sm); }
.crumb { font-size: 12.5px; color: var(--text-mute); display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 280px; overflow: hidden; }
.crumb .proj { color: var(--text-mute); }
.crumb .sep { color: var(--text-subtle); opacity: 0.6; }
.crumb .ttl { color: var(--text); font-weight: 500; max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type-pill { display: inline-flex; align-items: center; height: 19px; padding: 0 7px; border-radius: 999px;
  font-family: var(--mono-font); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em;
  border: 1px solid var(--hr); color: var(--text-subtle); flex-shrink: 0; }

.pickers { display: flex; align-items: center; gap: var(--s-2);
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  pointer-events: none; }
.pickers > * { pointer-events: auto; }
.vchip { display: inline-flex; align-items: center; gap: 6px;
  padding: 4px var(--s-3);
  background: var(--surface); border: 1px solid var(--hr-strong);
  border-radius: 999px; cursor: pointer;
  font-family: var(--mono-font); font-size: var(--fs-sm); color: var(--text);
  position: relative;
  transition: border-color var(--dur-fast), background var(--dur-fast); }
.vchip:hover { border-color: var(--text); }
.vchip .side { font-size: var(--fs-2xs); letter-spacing: var(--tracking-mono);
  text-transform: uppercase; opacity: 0.7;
  padding-right: 4px; border-right: 1px solid var(--hr); margin-right: 4px; }
.vchip.a .side { color: var(--accent-deep); opacity: 1; }
.vchip.b .side { color: var(--sky); opacity: 1; }
.vchip .ver { font-weight: 500; }
.vchip .cur { display: inline-block; width: 6px; height: 6px;
  background: var(--accent); border-radius: 50%; margin-left: 2px; }
.vchip .caret { font-size: 9px; opacity: 0.5; margin-left: 2px; }
.vchip select { position: absolute; inset: 0; opacity: 0; cursor: pointer;
  font: inherit; border: 0; background: var(--surface); color: var(--text);
  width: 100%; height: 100%; appearance: none; -webkit-appearance: none; }
.vchip select option { color: var(--text); background: var(--surface); }
.vchip.empty { background: transparent; border-style: dashed; color: var(--text-mute); }
.vchip.empty:hover { border-color: var(--accent); color: var(--accent-deep); }
.vchip-remove { background: transparent; border: 0; cursor: pointer;
  color: var(--text-subtle); font: inherit; font-size: 12px;
  padding: 0 2px; margin-left: 2px; border-radius: var(--radius-sm);
  position: relative; z-index: 2;
  transition: background var(--dur-fast), color var(--dur-fast); }
.vchip-remove:hover { color: var(--rose); background: var(--surface-2); }
.swap { background: transparent; border: 0; cursor: pointer; color: var(--text-mute);
  padding: 6px var(--s-2); border-radius: var(--radius-md); font-size: 16px;
  transition: background var(--dur-fast), color var(--dur-fast); }
.swap:hover { background: var(--surface-2); color: var(--text); }

.send-btn { height: 30px; padding: 0 var(--s-3);
  border-radius: var(--radius-md);
  border: 1px solid rgba(20, 20, 19, 0.18);
  background: linear-gradient(95deg, #c25d3a, #a89455 60%, #5a8a52);
  color: #ffffff; font: inherit; font-size: var(--fs-sm); font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  transition: filter var(--dur-fast); }
.send-btn:hover { filter: brightness(1.05); }
body[data-workbench="open"] .send-btn { display: none; }
.send-glyph { display: inline-flex; width: 12px; height: 12px; align-items: center; justify-content: center; }
.send-glyph svg { width: 12px; height: 12px; display: block; }

.modes { display: inline-flex; gap: 2px; background: var(--surface-2); border: 1px solid var(--hr);
  border-radius: 8px; padding: 2px; flex-shrink: 0; margin-left: auto; }
.mode { background: transparent; border: 0; cursor: pointer; color: var(--text-mute); font: inherit;
  font-size: 11.5px; padding: 4px 10px; border-radius: 6px; }
.mode.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

.archive-banner { flex: 0 0 auto; height: 34px; background: var(--surface-2); border-bottom: 1px solid var(--hr);
  display: flex; align-items: center; padding: 0 var(--s-4); gap: var(--s-3);
  font-size: var(--fs-sm); color: var(--text-mute); }
.archive-banner b { color: var(--text); font-weight: 500; }
.archive-banner .tag { font-family: var(--serif-font); font-style: italic; color: var(--text-subtle); }
.archive-banner .restore { margin-left: auto; color: var(--accent-deep); padding: 4px var(--s-2); border-radius: var(--radius-sm); }
.archive-banner .restore:hover { background: var(--accent-soft); }

.stage { flex: 1 1 auto; min-height: 0; position: relative; background: var(--surface); display: grid; }
.stage.state-single { grid-template-columns: 1fr; }
.stage.state-comparable { grid-template-columns: 1fr 1fr; }
.stage.state-comparable[data-mode="overlay"] { grid-template-columns: 1fr; }
.stage.state-not-comparable { grid-template-columns: 1fr; align-items: center; justify-items: center; }

.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.pane + .pane { border-left: 1px solid var(--hr); }
.pane-label { display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--hr); background: var(--surface-2);
  font-family: var(--mono-font); font-size: var(--fs-xs);
  color: var(--text-mute); letter-spacing: var(--tracking-mono-tight); }
.pane-label .side { font-size: var(--fs-2xs); letter-spacing: var(--tracking-mono);
  text-transform: uppercase; padding: 1px 5px; border-radius: 3px; }
.pane-a .pane-label .side { color: var(--accent-deep); background: rgba(217,119,87,0.10); }
.pane-b .pane-label .side { color: var(--sky); background: rgba(106,155,204,0.10); }
:root[data-theme="dark"] .pane-a .pane-label .side { color: var(--accent); background: rgba(217,119,87,0.18); }
:root[data-theme="dark"] .pane-b .pane-label .side { color: var(--sky); background: rgba(106,155,204,0.18); }
.pane-only .pane-label .side { color: var(--text-mute); background: transparent; }
.pane-label .ver { color: var(--text); font-weight: 600; }
.pane-label .cur-tag { color: var(--accent-deep); font-size: 9px;
  letter-spacing: var(--tracking-mono); text-transform: uppercase; }
.pane-actions { margin-left: auto; display: inline-flex; gap: 2px; align-items: center; }
.pane-action { background: transparent; border: 1px solid transparent;
  color: var(--text-mute); cursor: pointer;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  font: inherit; font-size: 12px; text-decoration: none;
  transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast); }
.pane-action:hover { background: var(--surface); color: var(--text); border-color: var(--hr); }
.pane-action.primary { color: var(--accent-deep); }
:root[data-theme="dark"] .pane-action.primary { color: var(--accent); }
:root[data-theme="dark"] .pane-label .cur-tag { color: var(--accent); }
:root[data-theme="dark"] .pane-action:hover { background: var(--surface-2); border-color: var(--hr-strong); }
.pane-menu { position: relative; }
.pane-menu summary { list-style: none; cursor: pointer; }
.pane-menu summary::-webkit-details-marker { display: none; }
.pane-menu .pop { position: absolute; right: 0; top: calc(100% + 4px);
  min-width: 200px; background: var(--surface);
  border: 1px solid var(--hr-strong); border-radius: var(--radius-md);
  box-shadow: var(--shadow); padding: 3px; z-index: 20; }
.pane-menu .pop a, .pane-menu .pop button { display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 4px;
  font: inherit; font-size: var(--fs-sm); color: var(--text);
  border: 0; background: transparent; width: 100%; text-align: left;
  cursor: pointer; text-decoration: none; }
.pane-menu .pop a:hover, .pane-menu .pop button:hover { background: var(--surface-2); }
.pane iframe { flex: 1; border: 0; width: 100%; background: var(--surface); }

/* overlay mode: layer pane-b on top of pane-a */
.stage[data-mode="overlay"] .pane-a { grid-column: 1; grid-row: 1; }
.stage[data-mode="overlay"] .pane-b { grid-column: 1; grid-row: 1; pointer-events: none; }
.stage[data-mode="overlay"] .pane-b iframe { opacity: var(--overlay-op, 0.5); transition: opacity 60ms linear; }

.overlay-control { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 6px 14px;
  background: var(--surface); border: 1px solid var(--hr-strong); border-radius: 999px;
  box-shadow: var(--shadow); z-index: 5; }
.overlay-label { font-family: var(--mono-font); font-size: 10px; color: var(--text-mute); letter-spacing: 0.1em; }
.overlay-control input { width: 220px; }

.empty-card { max-width: 480px; margin: auto;
  padding: var(--s-8) var(--s-9);
  background: var(--surface);
  border: 1px dashed var(--hr-strong);
  border-radius: var(--shell-radius);
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: var(--s-3); }
.empty-card .glyph { width: 64px; height: 64px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent-deep);
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: var(--s-2); }
.empty-card .glyph.subtle { background: var(--surface-2); color: var(--text-mute); }
.empty-card .glyph svg { width: 28px; height: 28px; display: block; }
.empty-card .tag { font-family: var(--serif-font); font-style: italic;
  font-size: var(--fs-md); color: var(--text-subtle); }
.empty-card h3 { margin: 0; font-family: var(--display-font); font-weight: 600;
  font-size: var(--fs-2xl); letter-spacing: var(--tracking-display); color: var(--text); }
.empty-card p { margin: 0; max-width: 38ch;
  font-size: var(--fs-md); color: var(--text-mute); line-height: var(--lh-normal); }
.empty-card code { font-family: var(--mono-font); font-size: var(--fs-xs);
  background: var(--surface-2); padding: 1px 5px; border-radius: 3px; }
.empty-row { display: flex; gap: var(--s-2); justify-content: center; flex-wrap: wrap; margin-top: var(--s-3); }
.empty-btn { display: inline-flex; align-items: center;
  padding: 7px var(--s-4); border-radius: var(--radius-md);
  border: 1px solid var(--hr-strong); background: var(--surface); color: var(--text);
  font-size: var(--fs-sm); text-decoration: none; cursor: pointer; }
.empty-btn:hover { border-color: var(--text); }
.empty-btn.primary { background: var(--accent); color: #ffffff; border-color: var(--accent-deep); }
.empty-btn.primary:hover { background: var(--accent-deep); }

@media (max-width: 720px) {
  .chrome { gap: 8px; padding: 0 8px; flex-wrap: wrap; height: auto; min-height: 50px; }
  .crumb { max-width: 140px; }
  .crumb .ttl { max-width: 12ch; }
}`;
}

function shellScript(versionsJson: string, currentVer: number, aVer: number, bVer: number | null): string {
  const verSourcesJson = JSON.stringify(
    [
      { key: "current", label: `current (v${currentVer})`, ver: currentVer, tone: "current" },
      { key: "a", label: `A · v${aVer}`, ver: aVer, tone: "a" },
      bVer !== null ? { key: "b", label: `B · v${bVer}`, ver: bVer, tone: "b" } : null,
    ].filter(Boolean)
  );
  return `(function(){
  var versions = ${versionsJson};
  var verSources = ${verSourcesJson};
  var url = new URL(window.location.href);
  var stage = document.querySelector('.stage');

  function setParam(k, v){
    if (v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
    window.location.href = url.toString();
  }

  document.querySelectorAll('select[data-picker]').forEach(function(sel){
    sel.addEventListener('change', function(){
      var key = sel.getAttribute('data-picker');
      if (key === 'a-ver') setParam('a', sel.value);
      else if (key === 'b-ver') setParam('b', sel.value);
    });
  });

  document.querySelectorAll('[data-add]').forEach(function(btn){
    btn.addEventListener('click', function(){
      // when adding pane B, default to current version
      var current = Number(document.body.dataset.current || '1');
      setParam('b', current);
    });
  });

  document.querySelectorAll('[data-remove]').forEach(function(btn){
    btn.addEventListener('click', function(){ setParam('b', null); });
  });

  document.querySelectorAll('[data-swap]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var a = url.searchParams.get('a');
      var b = url.searchParams.get('b');
      if (b === null) return;
      url.searchParams.set('a', b);
      url.searchParams.set('b', a || '');
      window.location.href = url.toString();
    });
  });

  document.querySelectorAll('.mode').forEach(function(btn){
    btn.addEventListener('click', function(){
      var m = btn.getAttribute('data-mode');
      setParam('mode', m === 'sxs' ? null : m);
    });
  });

  function openSendModal(){
    if (!window.MagpieSendModal) return;
    var vid = document.body.getAttribute('data-vid') || '';
    var current = Number(document.body.getAttribute('data-current') || '1');
    window.MagpieSendModal.open({ visualId: vid, currentVer: current, verSources: verSources });
  }
  document.querySelectorAll('[data-send-modal]').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.preventDefault(); openSendModal(); });
  });
  document.addEventListener('keydown', function(e){
    if (e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSendModal(); }
  });

  document.querySelectorAll('[data-copy-pane-link]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var ver = btn.getAttribute('data-copy-pane-link');
      var vid = document.body.getAttribute('data-vid') || '';
      var origin = window.location.origin;
      var href = origin + '/v/' + encodeURIComponent(vid) + '?ver=' + encodeURIComponent(ver);
      try { navigator.clipboard.writeText(href); } catch (_) {}
      var menu = btn.closest('details');
      if (menu) menu.removeAttribute('open');
    });
  });

  // overlay slider — live, no reload
  var overlay = document.querySelector('[data-overlay]');
  if (overlay && stage) {
    function applyOpacity(){
      var pct = Number(overlay.value) / 100;
      stage.style.setProperty('--overlay-op', String(pct));
    }
    applyOpacity();
    overlay.addEventListener('input', applyOpacity);
  }

  // pane-bridge relay for sync-scroll (Phase E will flesh out; B-stub here)
  var panes = Array.from(document.querySelectorAll('iframe[data-pane]'));
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.source !== 'magpie-pane') return;
    if (d.kind === 'scroll') {
      var sourceWin = e.source;
      panes.forEach(function(p){
        if (p.contentWindow !== sourceWin) {
          try { p.contentWindow.postMessage({kind:'scrollTo', fx: d.fx, fy: d.fy}, '*'); } catch (_) {}
        }
      });
    }
  });
})();`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
