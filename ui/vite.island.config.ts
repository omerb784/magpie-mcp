// Standalone IIFE bundles for server-rendered chrome surfaces.
// `send-modal.iife.js` boots the S6 VE workbench (preview / compare / drawer
// / /compose/:id route). `templates.iife.js` (S7 P4.B) boots the templates
// manager (/templates list + /templates/:id builder).
//
// Both bundles mount to a fixed root div the shell pre-creates; both expose
// a `window.MagpieXxx.open()` surface so the boot script can poll until
// the bundle finishes parsing.
//
// Select the entry with `ISLAND_ENTRY=workbench|templates` env var; defaults
// to workbench so the existing build script (`vite build ... --config`)
// keeps shipping the workbench bundle.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

const ENTRY = process.env.ISLAND_ENTRY ?? "workbench";

const islands = {
  workbench: {
    entry: resolve(__dirname, "src", "WorkbenchIsland.tsx"),
    name: "MagpieWorkbenchIsland",
    fileName: "send-modal.iife.js",
  },
  templates: {
    entry: resolve(__dirname, "src", "TemplatesIsland.tsx"),
    name: "MagpieTemplatesIsland",
    fileName: "templates.iife.js",
  },
};

const picked = islands[ENTRY as keyof typeof islands] ?? islands.workbench;

export default defineConfig({
  plugins: [react()],
  // React 18 reads process.env.NODE_ENV at runtime; Vite's lib mode does not
  // inject the standard `define` replacements automatically, so the IIFE
  // bundle would throw "process is not defined" on load. Inline the constant.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: resolve(__dirname, "..", "dist", "ui", "assets"),
    emptyOutDir: false,
    sourcemap: false,
    minify: "esbuild",
    lib: {
      entry: picked.entry,
      name: picked.name,
      formats: ["iife"],
      fileName: () => picked.fileName,
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
