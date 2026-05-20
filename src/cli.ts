#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { config } from "./config.js";

function openUrl(url: string): void {
  const p = platform();
  try {
    if (p === "darwin") execSync(`open "${url}"`);
    else if (p === "win32") execSync(`start "" "${url}"`, { shell: "cmd.exe" });
    else execSync(`xdg-open "${url}"`);
  } catch {
    console.error(`[magpie] could not auto-open browser. Visit: ${url}`);
  }
}

function main(): void {
  if (!existsSync(config.lastPortFile)) {
    console.error(
      `[magpie] no running server found. Start with: npx magpie-mcp (or add to your Claude config).`
    );
    process.exit(1);
  }
  const port = readFileSync(config.lastPortFile, "utf8").trim();
  if (!/^\d+$/.test(port)) {
    console.error(`[magpie] invalid last-port file at ${config.lastPortFile}`);
    process.exit(1);
  }
  const url = `http://${config.bind}:${port}`;
  console.error(`[magpie] opening ${url}`);
  openUrl(url);
}

main();
