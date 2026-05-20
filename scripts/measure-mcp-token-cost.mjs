#!/usr/bin/env node
// v0.9.2 / Phase C / M4 — Token-cost audit harness.
//
// Emits per-tool / per-prompt / instructions byte+token-estimate JSON.
// Token estimate uses chars/4 — rough OpenAI BPE heuristic. Anthropic
// tokens run similar order of magnitude for ASCII English; treat as a
// floor, not exact. Goal: rank costs, identify outliers — not bill.
//
// Run: `node scripts/measure-mcp-token-cost.mjs [--pretty]`
// Pretty mode prints a table; default mode emits JSON for piping.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distMcp = join(root, "dist", "mcp");

const { TOOLS } = await import(`file://${join(distMcp, "tools", "index.js").replace(/\\/g, "/")}`);
const { PROMPTS } = await import(`file://${join(distMcp, "prompts", "index.js").replace(/\\/g, "/")}`);
const { INSTRUCTIONS } = await import(`file://${join(distMcp, "instructions.js").replace(/\\/g, "/")}`);

const byteLen = (s) => Buffer.byteLength(s, "utf8");
const tokEst = (s) => Math.ceil(s.length / 4);

const toolRows = TOOLS.map((t) => {
  const desc = t.description ?? "";
  const schemaJson = JSON.stringify(t.inputSchema);
  const totalStr = desc + schemaJson;
  return {
    name: t.name,
    desc_bytes: byteLen(desc),
    schema_bytes: byteLen(schemaJson),
    total_bytes: byteLen(totalStr),
    tok_est: tokEst(totalStr),
  };
}).sort((a, b) => b.total_bytes - a.total_bytes);

const promptRows = PROMPTS.map((p) => {
  const desc = p.description ?? "";
  const argsJson = JSON.stringify(p.arguments ?? []);
  const total = desc + argsJson;
  return {
    name: p.name,
    desc_bytes: byteLen(desc),
    args_bytes: byteLen(argsJson),
    total_bytes: byteLen(total),
    tok_est: tokEst(total),
  };
}).sort((a, b) => b.total_bytes - a.total_bytes);

const instructionsRow = {
  bytes: byteLen(INSTRUCTIONS),
  tok_est: tokEst(INSTRUCTIONS),
};

const totals = {
  tools_total_bytes: toolRows.reduce((s, r) => s + r.total_bytes, 0),
  tools_total_tok_est: toolRows.reduce((s, r) => s + r.tok_est, 0),
  prompts_total_bytes: promptRows.reduce((s, r) => s + r.total_bytes, 0),
  prompts_total_tok_est: promptRows.reduce((s, r) => s + r.tok_est, 0),
  instructions_bytes: instructionsRow.bytes,
  instructions_tok_est: instructionsRow.tok_est,
  grand_total_bytes:
    toolRows.reduce((s, r) => s + r.total_bytes, 0) +
    promptRows.reduce((s, r) => s + r.total_bytes, 0) +
    instructionsRow.bytes,
  grand_total_tok_est:
    toolRows.reduce((s, r) => s + r.tok_est, 0) +
    promptRows.reduce((s, r) => s + r.tok_est, 0) +
    instructionsRow.tok_est,
};

const out = {
  generated_at: new Date().toISOString(),
  note: "Token estimate is chars/4. Floor only; real Anthropic tokenizer may differ.",
  tools: toolRows,
  prompts: promptRows,
  instructions: instructionsRow,
  totals,
};

if (process.argv.includes("--pretty")) {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log("\n== Tools (sorted by total_bytes desc) ==");
  console.log(`${pad("name", 18)} ${padL("desc", 6)} ${padL("schema", 7)} ${padL("total", 6)} ${padL("~tok", 5)}`);
  for (const r of toolRows) {
    console.log(`${pad(r.name, 18)} ${padL(r.desc_bytes, 6)} ${padL(r.schema_bytes, 7)} ${padL(r.total_bytes, 6)} ${padL(r.tok_est, 5)}`);
  }
  console.log("\n== Prompts (sorted by total_bytes desc) ==");
  console.log(`${pad("name", 20)} ${padL("desc", 6)} ${padL("args", 6)} ${padL("total", 6)} ${padL("~tok", 5)}`);
  for (const r of promptRows) {
    console.log(`${pad(r.name, 20)} ${padL(r.desc_bytes, 6)} ${padL(r.args_bytes, 6)} ${padL(r.total_bytes, 6)} ${padL(r.tok_est, 5)}`);
  }
  console.log("\n== Instructions string ==");
  console.log(`bytes=${instructionsRow.bytes}  ~tok=${instructionsRow.tok_est}`);
  console.log("\n== Totals ==");
  for (const [k, v] of Object.entries(totals)) console.log(`  ${pad(k, 28)} ${padL(v, 8)}`);
  console.log();
} else {
  console.log(JSON.stringify(out, null, 2));
}
