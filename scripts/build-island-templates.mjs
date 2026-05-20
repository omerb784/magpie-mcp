// S7 P4.B — build the templates IIFE bundle as a sibling to the workbench
// bundle. We can't pass env vars cross-platform via npm scripts without
// adding cross-env, so spawn vite directly with ISLAND_ENTRY=templates.

import { spawn } from "node:child_process";
import process from "node:process";

process.env.ISLAND_ENTRY = "templates";
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
// DEP0190: pass single command string (not args array) when shell:true.
// Args here are hardcoded literals — no injection surface.
const child = spawn(
  `${cmd} vite build ui --config ui/vite.island.config.ts`,
  { env: process.env, stdio: "inherit", shell: true },
);
child.on("exit", (code) => process.exit(code ?? 0));
