// S7 P4.B — IIFE entry for `/templates` + `/templates/:id`. Mirrors the
// shape of WorkbenchIsland: server shell pre-creates a mount node + calls
// `window.MagpieTemplates.open({ id?: string })` once the bundle parses.
//
// The Templates page is fully self-contained (no dashboard chrome). It
// handles its own routing internally — pushes /templates/:id when the user
// opens a builder, pops back to /templates on save/cancel. Keeps the URL
// shareable without dragging a SPA router along.

import { createRoot, type Root } from "react-dom/client";
import { StrictMode, useEffect, useState } from "react";
import { TemplatesPage } from "./templates/TemplatesPage.js";

export interface OpenOpts {
  id?: string | null;
}

const MOUNT_ID = "magpie-templates-root";
let activeRoot: Root | null = null;

function ensureMount(): HTMLDivElement {
  let el = document.getElementById(MOUNT_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = MOUNT_ID;
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  return el;
}

function App({ initialId }: { initialId: string | null }) {
  // Resolve current path on every popstate so back/forward navigation
  // between /templates and /templates/:id stays in sync with the UI.
  const [id, setId] = useState<string | null>(initialId);
  useEffect(() => {
    function onPop() {
      const m = window.location.pathname.match(/^\/templates\/(.+)$/);
      setId(m ? decodeURIComponent(m[1]) : null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return (
    <TemplatesPage
      activeId={id}
      onOpen={(nextId) => {
        if (nextId === null) {
          window.history.pushState({}, "", "/templates");
          setId(null);
        } else {
          window.history.pushState({}, "", `/templates/${encodeURIComponent(nextId)}`);
          setId(nextId);
        }
      }}
    />
  );
}

function open(opts: OpenOpts): void {
  if (activeRoot) return;
  const mount = ensureMount();
  activeRoot = createRoot(mount);
  const initialId = opts.id ?? null;
  activeRoot.render(
    <StrictMode>
      <App initialId={initialId} />
    </StrictMode>,
  );
}

declare global {
  interface Window {
    MagpieTemplates?: { open: (opts: OpenOpts) => void };
  }
}

window.MagpieTemplates = { open };
