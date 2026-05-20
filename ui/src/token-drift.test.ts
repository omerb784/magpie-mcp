import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".css") || e.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const SCAN_ROOT = here;
const EXCLUDE_BY_BASENAME = new Set(["index.css"]);
const EXCLUDE_BY_SUFFIX = [".test.ts", ".test.tsx", ".d.ts"];

const LADDER_SPACING = new Set([0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 56]);
const LADDER_RADIUS = new Set([2, 4, 6, 8, 10, 14, 999]);

const SPACING_PROPS = [
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
];

interface Violation {
  file: string;
  line: number;
  kind: string;
  match: string;
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split("\n").length;
}

function hasAllowDirective(src: string, idx: number): boolean {
  const lineStart = src.lastIndexOf("\n", idx - 1) + 1;
  const curLine = src.slice(lineStart, src.indexOf("\n", idx));
  if (/token-drift-allow:/.test(curLine)) return true;
  let scanEnd = lineStart - 1;
  for (let i = 0; i < 25; i++) {
    if (scanEnd <= 0) break;
    const prevLineStart = src.lastIndexOf("\n", scanEnd - 1) + 1;
    const prevLine = src.slice(prevLineStart, scanEnd);
    if (/token-drift-allow:/.test(prevLine)) return true;
    if (/\}\s*$|^\s*\}/.test(prevLine)) break;
    if (prevLineStart === 0) break;
    scanEnd = prevLineStart - 1;
  }
  return false;
}

function isInCommentBlock(src: string, idx: number): boolean {
  const blockOpen = src.lastIndexOf("/*", idx);
  if (blockOpen >= 0) {
    const blockClose = src.lastIndexOf("*/", idx);
    if (blockClose < blockOpen) return true;
  }
  const lineStart = src.lastIndexOf("\n", idx - 1) + 1;
  const lineUpto = src.slice(lineStart, idx);
  if (lineUpto.includes("//")) return true;
  return false;
}

function scanFile(filePath: string): Violation[] {
  const src = readFileSync(filePath, "utf8");
  const rel = relative(SCAN_ROOT, filePath).replace(/\\/g, "/");
  const violations: Violation[] = [];

  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  for (const m of src.matchAll(hexRe)) {
    const idx = m.index ?? 0;
    if (hasAllowDirective(src, idx)) continue;
    if (isInCommentBlock(src, idx)) continue;
    const before = src.slice(Math.max(0, idx - 40), idx);
    if (/href=["']$/.test(before)) continue;
    if (/anchor:\s*#$|magpie:\/\/$/.test(before)) continue;
    violations.push({ file: rel, line: lineOf(src, idx), kind: "raw-hex", match: m[0] });
  }

  const rgbaRe = /rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+(?:[\s,]+[0-9.]+)?\s*\)/g;
  for (const m of src.matchAll(rgbaRe)) {
    const idx = m.index ?? 0;
    if (hasAllowDirective(src, idx)) continue;
    if (isInCommentBlock(src, idx)) continue;
    if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(m[0])) continue;
    violations.push({ file: rel, line: lineOf(src, idx), kind: "raw-rgba", match: m[0] });
  }

  const isCss = filePath.endsWith(".css");
  for (const prop of SPACING_PROPS) {
    const re = isCss
      ? new RegExp(`(^|[^a-zA-Z\\-])${prop}:\\s*([^;]+);`, "g")
      : new RegExp(`(?:\\b|["'\`])${prop}:\\s*(?:["'\`]([^"'\`]+)["'\`]|([0-9][^,;\\n}]*))`, "g");
    for (const m of src.matchAll(re)) {
      const valStr = isCss ? m[2] : (m[1] ?? m[2] ?? "");
      const idx = (m.index ?? 0) + m[0].indexOf(":") + 1;
      if (hasAllowDirective(src, idx)) continue;
      if (isInCommentBlock(src, idx)) continue;
      const tokens = valStr.split(/\s+/).filter((t) => t.length > 0);
      for (const tk of tokens) {
        const pxMatch = /^-?(\d+)px$/.exec(tk);
        if (!pxMatch) continue;
        const px = parseInt(pxMatch[1], 10);
        if (LADDER_SPACING.has(px)) continue;
        violations.push({
          file: rel,
          line: lineOf(src, idx),
          kind: `raw-px-spacing(${prop})`,
          match: `${prop}: ${valStr}`,
        });
      }
    }
  }

  const radiusRe = isCss
    ? /(^|[^a-zA-Z\-])border-radius:\s*([^;]+);/g
    : /borderRadius:\s*(?:["'`]([^"'`]+)["'`]|([0-9][^,;\n}]*))/g;
  for (const m of src.matchAll(radiusRe)) {
    const valStr = isCss ? m[2] : (m[1] ?? m[2] ?? "");
    const idx = m.index ?? 0;
    if (hasAllowDirective(src, idx)) continue;
    if (isInCommentBlock(src, idx)) continue;
    const tokens = valStr.split(/\s+/).filter((t) => t.length > 0);
    for (const tk of tokens) {
      const pxMatch = /^(\d+)px$/.exec(tk);
      if (!pxMatch) continue;
      const px = parseInt(pxMatch[1], 10);
      if (LADDER_RADIUS.has(px)) continue;
      violations.push({
        file: rel,
        line: lineOf(src, idx),
        kind: "raw-px-radius",
        match: `border-radius: ${valStr}`,
      });
    }
  }

  const shadowRe = isCss ? /box-shadow:\s*([^;]+);/g : /boxShadow:\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(shadowRe)) {
    const valStr = m[1];
    const idx = m.index ?? 0;
    if (hasAllowDirective(src, idx)) continue;
    if (isInCommentBlock(src, idx)) continue;
    if (/^\s*none\s*$/i.test(valStr)) continue;
    if (/^\s*var\(--shadow-/.test(valStr)) continue;
    if (/^\s*0\s+0\s+0\s+/i.test(valStr)) continue;
    if (/inset\s+0\s+0\s+0/i.test(valStr)) continue;
    if (/^var\(/.test(valStr.trim())) continue;
    violations.push({
      file: rel,
      line: lineOf(src, idx),
      kind: "raw-box-shadow",
      match: `box-shadow: ${valStr.slice(0, 60)}`,
    });
  }

  return violations;
}

function shouldScan(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (EXCLUDE_BY_BASENAME.has(base)) return false;
  for (const suf of EXCLUDE_BY_SUFFIX) if (base.endsWith(suf)) return false;
  return true;
}

describe("Ib1 · UI token drift static-probe (Dec-iii hard gate)", () => {
  const allFiles = walk(SCAN_ROOT).filter(shouldScan);
  const allViolations: Violation[] = [];
  for (const f of allFiles) {
    allViolations.push(...scanFile(f));
  }

  it("walks ui/src/**/*.{tsx,css,ts} excluding index.css + tests", () => {
    expect(allFiles.length).toBeGreaterThan(5);
    expect(allFiles.some((f) => f.endsWith("App.tsx"))).toBe(true);
    expect(allFiles.some((f) => f.endsWith("index.css"))).toBe(false);
  });

  it("forbids raw hex literals (use --ink/--paper/--cobalt/--fmt-* tokens)", () => {
    const hits = allViolations.filter((v) => v.kind === "raw-hex");
    if (hits.length > 0) {
      const sample = hits.slice(0, 8).map((v) => `${v.file}:${v.line} · ${v.match}`).join("\n  ");
      throw new Error(`raw-hex drift (${hits.length}):\n  ${sample}`);
    }
    expect(hits.length).toBe(0);
  });

  it("forbids raw rgba literals (use hairline/shadow tokens or var())", () => {
    const hits = allViolations.filter((v) => v.kind === "raw-rgba");
    if (hits.length > 0) {
      const sample = hits.slice(0, 8).map((v) => `${v.file}:${v.line} · ${v.match}`).join("\n  ");
      throw new Error(`raw-rgba drift (${hits.length}):\n  ${sample}`);
    }
    expect(hits.length).toBe(0);
  });

  it("forbids raw px spacing values outside the --s-* ladder (2/4/8/12/16/20/24/32/40/56)", () => {
    const hits = allViolations.filter((v) => v.kind.startsWith("raw-px-spacing"));
    if (hits.length > 0) {
      const sample = hits.slice(0, 12).map((v) => `${v.file}:${v.line} · ${v.kind} · ${v.match}`).join("\n  ");
      throw new Error(`raw-px-spacing drift (${hits.length}):\n  ${sample}`);
    }
    expect(hits.length).toBe(0);
  });

  it("forbids raw px border-radius outside the --radius-* ladder (2/4/6/8/10/14/999)", () => {
    const hits = allViolations.filter((v) => v.kind === "raw-px-radius");
    if (hits.length > 0) {
      const sample = hits.slice(0, 8).map((v) => `${v.file}:${v.line} · ${v.match}`).join("\n  ");
      throw new Error(`raw-px-radius drift (${hits.length}):\n  ${sample}`);
    }
    expect(hits.length).toBe(0);
  });

  it("forbids raw box-shadow not referencing --shadow-* tokens", () => {
    const hits = allViolations.filter((v) => v.kind === "raw-box-shadow");
    if (hits.length > 0) {
      const sample = hits.slice(0, 8).map((v) => `${v.file}:${v.line} · ${v.match}`).join("\n  ");
      throw new Error(`raw-box-shadow drift (${hits.length}):\n  ${sample}`);
    }
    expect(hits.length).toBe(0);
  });

  it("aggregate · zero token drift across ui/src/** (Dec-iii hard gate)", () => {
    expect(allViolations.length).toBe(0);
  });
});
