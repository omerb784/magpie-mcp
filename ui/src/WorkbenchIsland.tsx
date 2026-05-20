// Standalone bootstrapper that mounts the dashboard workbench into the
// server-rendered preview/compare chrome. Same React component as the
// dashboard drawer — no fork. Built as an IIFE (dist/ui/assets/send-modal.iife.js)
// and loaded via a single <script defer> in the chrome head.
//
// Public surface (unchanged from S6 P12):
//   window.MagpieSendModal.open({ visualId, currentVer?, versionShown?, verSources? })
// The workbench manages its own lifecycle (mount on open, unmount on close).

import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import type { SendTemplate } from "./send-template-utils.js";
import {
  WorkbenchHost,
  type WorkbenchHostCompare,
  type WorkbenchHostVisual,
} from "./WorkbenchHost.js";
import { autoCopyEnabled, clipboardCommandForInbox } from "./workbench/host-helpers.js";
import type { VerSource, WorkbenchMode } from "./workbench/types.js";

export interface OpenOpts {
  visualId: string;
  currentVer?: number;
  versionShown?: number;
  verSources?: VerSource[];
  /** Layout override. v0.9.3 Phase F · Q2 lock — only "panel" and
   *  "narrow" remain after `fullpage`/`/compose` route was dropped. */
  mode?: WorkbenchMode;
}

interface ApiVisualResponse {
  visual: {
    id: string;
    title: string;
    type: string;
    current_ver: number;
    current_render_status?: string;
    thumb_version?: number | null;
    project_id?: string;
  };
}

const MOUNT_ID = "magpie-send-modal-mount";
let activeRoot: Root | null = null;
let activeMount: HTMLDivElement | null = null;

function ensureMount(): HTMLDivElement {
  let el = document.getElementById(MOUNT_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = MOUNT_ID;
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "9000",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  return el;
}

function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeMount && activeMount.parentNode) {
    activeMount.parentNode.removeChild(activeMount);
    activeMount = null;
  }
  // P14 — release chrome Send hide.
  document.body.removeAttribute("data-workbench");
}

function pushToast(kind: "info" | "success" | "error", msg: string): void {
  const node = document.createElement("div");
  node.className = `magpie-island-toast magpie-island-toast--${kind}`;
  node.textContent = msg;
  /* token-drift-allow: fallback values inside var() are literal mirrors of
     --surface / --text / --hr-strong / --shadow tokens; required because this
     toast is JS-injected outside the React root and may run before the
     stylesheet attaches. CSS wins on runtime; these strings only matter for
     the first paint of the standalone workbench iframe. */
  Object.assign(node.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "var(--surface, #ffffff)",
    color: "var(--text, #0e0f14)",
    border: "1px solid var(--hr-strong, rgba(14,15,20,0.18))",
    borderRadius: "8px",
    padding: "8px 16px",
    fontSize: "12.5px",
    boxShadow: "var(--shadow, 0 14px 36px rgba(14,18,40,0.10))",
    zIndex: "9999",
    fontFamily: "var(--ui-font, system-ui)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(node);
  setTimeout(() => {
    node.style.transition = "opacity 240ms";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 260);
  }, 1800);
}

interface LoadedPayload {
  visual: WorkbenchHostVisual | WorkbenchHostCompare;
  templates: SendTemplate[];
  projectId?: string;
  verSources?: VerSource[];
  compareMode: boolean;
  mode?: WorkbenchMode;
}

async function loadPayload(opts: OpenOpts): Promise<LoadedPayload> {
  // S7 P3.C — fetch the visual first so we know its project id, then ask
  // for templates filtered by scope. One extra round-trip on island mount;
  // the host re-fetches anyway if visual.id changes.
  const vRes = await fetch(`/api/visuals/${encodeURIComponent(opts.visualId)}`);
  if (!vRes.ok) throw new Error(`visual fetch failed (${vRes.status})`);
  const vJson = (await vRes.json()) as ApiVisualResponse;
  const v = vJson.visual;
  const tParams = new URLSearchParams();
  if (v.project_id) tParams.set("project", v.project_id);
  tParams.set("visual", v.id);
  const tRes = await fetch(`/api/send-templates?${tParams.toString()}`);
  if (!tRes.ok) throw new Error(`templates fetch failed (${tRes.status})`);
  const templates = (await tRes.json()) as SendTemplate[];
  const thumb_url =
    v.current_render_status === "ok" && v.thumb_version != null
      ? `/thumbs/${v.id}/v${v.thumb_version}.png`
      : null;

  const sources = opts.verSources;
  const hasA = sources?.some((s) => s.tone === "a") ?? false;
  const hasB = sources?.some((s) => s.tone === "b") ?? false;
  const isCompare = !!sources && hasA && hasB;

  if (isCompare) {
    const aSrc = sources!.find((s) => s.tone === "a")!;
    const bSrc = sources!.find((s) => s.tone === "b")!;
    const currentSrc =
      sources!.find((s) => s.tone === "current") ?? {
        ver: opts.currentVer ?? v.current_ver,
      };
    const compare: WorkbenchHostCompare = {
      id: v.id,
      title: v.title,
      fmt: v.type,
      a: { ver: aSrc.ver },
      b: { ver: bSrc.ver },
      current: { ver: currentSrc.ver },
    };
    return {
      visual: compare,
      templates,
      projectId: v.project_id,
      verSources: sources,
      compareMode: true,
      mode: opts.mode,
    };
  }

  const initialVer = opts.versionShown ?? opts.currentVer ?? v.current_ver;
  const single: WorkbenchHostVisual = {
    id: v.id,
    title: v.title,
    fmt: v.type,
    ver: initialVer,
    thumb_url,
  };
  return {
    visual: single,
    templates,
    projectId: v.project_id,
    verSources: sources,
    compareMode: false,
    mode: opts.mode,
  };
}

async function open(opts: OpenOpts): Promise<void> {
  if (activeRoot) return;
  let payload: LoadedPayload;
  try {
    payload = await loadPayload(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushToast("error", `Couldn't open Talk with agent: ${msg}`);
    return;
  }
  activeMount = ensureMount();
  activeMount.style.pointerEvents = "auto";
  // P14 — chrome Send hides while workbench is mounted.
  document.body.setAttribute("data-workbench", "open");
  activeRoot = createRoot(activeMount);

  const renderWorkbench = () => {
    activeRoot!.render(
      <StrictMode>
        <WorkbenchHost
          visual={payload.visual}
          compareMode={payload.compareMode}
          mode={payload.mode}
          templates={payload.templates}
          projectId={payload.projectId}
          verSources={payload.verSources}
          onClose={unmount}
          onCopy={(text) => {
            try {
              void navigator.clipboard.writeText(text);
              pushToast("success", "Copied to clipboard");
            } catch {
              pushToast("error", "Clipboard write failed");
            }
          }}
          onSendToInbox={async ({ body, template_id, template_version_num }) => {
            try {
              const r = await fetch("/api/inbox", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  visual_id: payload.visual.id,
                  template_id: template_id ?? undefined,
                  template_version_num: template_version_num ?? undefined,
                  prompt_body: body,
                }),
              });
              if (!r.ok) {
                const err = (await r.json().catch(() => ({}))) as { error?: string };
                pushToast("error", `Send failed: ${err.error ?? r.status}`);
                return;
              }
              // S7 P6 — warm-handoff: copy the magpie command to clipboard
              // (best-effort; some browsers reject without a gesture) so
              // the user can paste straight into their LLM. Default-on
              // with localStorage opt-out per Q5 lock.
              const data = (await r.json().catch(() => ({}))) as { id?: string };
              if (
                data.id &&
                autoCopyEnabled(typeof window !== "undefined" ? window.localStorage : null)
              ) {
                try {
                  await navigator.clipboard.writeText(clipboardCommandForInbox(data.id));
                } catch {
                  /* silent — clipboard write isn't critical */
                }
              }
              pushToast("success", "Sent · paste in your LLM");
              unmount();
            } catch (err) {
              pushToast("error", `Send failed: ${(err as Error).message}`);
            }
          }}
        />
      </StrictMode>,
    );
  };
  renderWorkbench();
}

declare global {
  interface Window {
    MagpieSendModal?: { open: (opts: OpenOpts) => void };
  }
}

window.MagpieSendModal = { open };
