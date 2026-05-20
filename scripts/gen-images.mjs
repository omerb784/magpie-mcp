#!/usr/bin/env node
// Generate Magpie brand-kit raster images via OpenAI gpt-image-2.
// Prompts live in scripts/image-prompts.mjs (mirrored from visual xBAZVuPoZv5d).
//
// Usage:
//   node scripts/gen-images.mjs                # default: pending + new (P06 + M01-M04)
//   node scripts/gen-images.mjs --id M01
//   node scripts/gen-images.mjs --id P05,M01,M02
//   node scripts/gen-images.mjs --all          # all 10, incl already-rendered
//   node scripts/gen-images.mjs --list         # print plan only, no API calls
//   node scripts/gen-images.mjs --force        # overwrite existing files
//
// Env:
//   OPENAI_API_KEY   required
//   OPENAI_BASE_URL  optional override (default https://api.openai.com)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPTS } from "./image-prompts.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
const API_URL = `${BASE_URL}/v1/images/generations`;
const MODEL = "gpt-image-2";

function parseArgs(argv) {
  const args = { ids: null, all: false, list: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--list") args.list = true;
    else if (a === "--force") args.force = true;
    else if (a === "--id" || a === "--ids") {
      args.ids = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--id=") || a.startsWith("--ids=")) {
      args.ids = a.slice(a.indexOf("=") + 1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`gen-images.mjs — drive gpt-image-2 for Magpie brand kit.

  --id <IDS>   comma-separated prompt ids (e.g. M01,M02). case-insensitive.
  --all        run all 10 entries (incl rendered + winner).
  --list       print plan, no API calls.
  --force      overwrite existing output files.

Default (no args): pending + new statuses (P06 + M01..M04).
Set OPENAI_API_KEY before running.`);
}

function expand(entry) {
  if (entry.pose_variants && entry.pose_variants.length) {
    return entry.pose_variants.map((v) => ({
      id: `${entry.id}-${v.suffix}`,
      title: `${entry.title} · pose ${v.suffix}`,
      save_path: entry.save_path.replace("{N}", v.suffix),
      prompt: entry.prompt.replace("{POSE}", v.pose),
      size: entry.size,
      quality: entry.quality,
    }));
  }
  return [{
    id: entry.id,
    title: entry.title,
    save_path: entry.save_path,
    prompt: entry.prompt,
    size: entry.size,
    quality: entry.quality,
  }];
}

function selectEntries(args) {
  if (args.ids) {
    const want = new Set(args.ids.map((s) => s.toUpperCase()));
    const hits = PROMPTS.filter((p) => want.has(p.id.toUpperCase()));
    const missing = [...want].filter((w) => !hits.some((h) => h.id.toUpperCase() === w));
    if (missing.length) {
      console.error(`Unknown id(s): ${missing.join(", ")}. Available: ${PROMPTS.map((p) => p.id).join(", ")}`);
      process.exit(2);
    }
    return hits;
  }
  if (args.all) return PROMPTS;
  return PROMPTS.filter((p) => p.status === "pending" || p.status === "new");
}

async function generate(entry, apiKey) {
  const body = {
    model: MODEL,
    prompt: entry.prompt,
    size: entry.size,
    quality: entry.quality,
    n: 1,
  };
  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} after ${elapsed}s — ${text.slice(0, 500)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Missing b64_json. Body: ${text.slice(0, 400)}`);
  return { b64, elapsed, usage: json.usage, revised: json.data[0].revised_prompt };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !args.list) {
    console.error("ERROR: OPENAI_API_KEY env var not set.\n");
    console.error("  PowerShell:  $env:OPENAI_API_KEY = \"sk-...\"; node scripts/gen-images.mjs");
    console.error("  Bash:        OPENAI_API_KEY=sk-... node scripts/gen-images.mjs");
    process.exit(1);
  }

  const selected = selectEntries(args);
  if (!selected.length) {
    console.error("No prompts selected. Try --list or --all or --id <IDs>.");
    process.exit(1);
  }

  const jobs = selected.flatMap(expand);

  console.log(`Plan · ${jobs.length} render(s) via ${MODEL}`);
  console.log("ID        size         quality  save_path");
  console.log("--------  -----------  -------  ----------------------------------------");
  for (const j of jobs) {
    const abs = path.resolve(REPO_ROOT, j.save_path);
    const exists = fs.existsSync(abs);
    console.log(`${j.id.padEnd(8)}  ${j.size.padEnd(11)}  ${j.quality.padEnd(7)}  ${j.save_path}${exists ? "  [exists]" : ""}`);
  }
  if (args.list) return;
  console.log("");

  let okN = 0, failN = 0, skipN = 0;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const abs = path.resolve(REPO_ROOT, j.save_path);
    if (fs.existsSync(abs) && !args.force) {
      console.log(`[${i + 1}/${jobs.length}] ${j.id} — skip (exists). --force to regenerate.`);
      skipN++;
      continue;
    }
    process.stdout.write(`[${i + 1}/${jobs.length}] ${j.id} ${j.size} … `);
    try {
      const { b64, elapsed, usage } = await generate(j, apiKey);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(b64, "base64"));
      const tokTag = usage
        ? ` · in=${usage.input_tokens ?? usage.prompt_tokens ?? "?"} out=${usage.output_tokens ?? usage.completion_tokens ?? "?"}`
        : "";
      console.log(`ok ${elapsed}s${tokTag} → ${j.save_path}`);
      okN++;
    } catch (err) {
      console.log("FAIL");
      console.error(`    ${err.message}`);
      failN++;
    }
  }
  console.log(`\nDone · ${okN} ok · ${skipN} skipped · ${failN} failed`);
  if (failN > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
