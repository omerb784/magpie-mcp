import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const appTsx = readFileSync(join(here, "App.tsx"), "utf8");

function srgb(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function tokenValue(name: string): string {
  const re = new RegExp(`${name.replace(/-/g, "\\-")}:\\s*(#[0-9a-fA-F]{3,8})`);
  const m = css.match(re);
  if (!m) throw new Error(`token ${name} not found in index.css`);
  return m[1];
}

describe("Ia2 · WCAG 2.2 AA contrast snapshot", () => {
  it("primary text --ink on --paper exceeds 4.5:1 body bar (light theme)", () => {
    const r = contrast(tokenValue("--ink"), tokenValue("--paper"));
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  it("primary text --ink-d on --paper-d exceeds 4.5:1 body bar (dark theme)", () => {
    const r = contrast(tokenValue("--ink-d"), tokenValue("--paper-d"));
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  it("brand accent --cobalt on --paper exceeds 4.5:1 body bar (links + key UI)", () => {
    const r = contrast(tokenValue("--cobalt"), tokenValue("--paper"));
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  it("body-mute #5a5e6d (text-mute light) on white exceeds 4.5:1 body bar", () => {
    const r = contrast("#5a5e6d", "#ffffff");
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  it("body-mute #a3a8bb (text-mute dark) on paper-d2 exceeds 4.5:1 body bar", () => {
    const r = contrast("#a3a8bb", "#141826");
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  it("subtle-text #8b8f9c (text-subtle light) on white exceeds 3:1 UI bar", () => {
    const r = contrast("#8b8f9c", "#ffffff");
    expect(r).toBeGreaterThanOrEqual(3);
  });

  it("subtle-text #6a7088 (text-subtle dark) on paper-d2 exceeds 3:1 UI bar", () => {
    const r = contrast("#6a7088", "#141826");
    expect(r).toBeGreaterThanOrEqual(3);
  });

  it("--mid #9396a1 on --paper FAILS 4.5:1 — must not be used as body text", () => {
    const r = contrast(tokenValue("--mid"), tokenValue("--paper"));
    expect(r).toBeLessThan(4.5);
    expect(appTsx).not.toMatch(/color:\s*["']var\(--mid\)["']/);
  });
});

describe("Ia2 · WCAG 2.5.8 target-size — chrome interactive minimums", () => {
  function selectorBlock(selector: string): string {
    const lit = selector.replace(/[.]/g, "\\.");
    const re = new RegExp(`^${lit}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
    const m = css.match(re);
    if (!m) throw new Error(`selector ${selector} not found`);
    return m[0];
  }

  function readPx(block: string, prop: string): number {
    const re = new RegExp(`${prop}:\\s*(\\d+)px`);
    const m = block.match(re);
    if (!m) throw new Error(`${prop} not found in block`);
    return parseInt(m[1], 10);
  }

  it(".icon-btn meets 24x24 minimum (32x32 actual)", () => {
    const b = selectorBlock(".icon-btn");
    expect(readPx(b, "width")).toBeGreaterThanOrEqual(24);
    expect(readPx(b, "height")).toBeGreaterThanOrEqual(24);
  });

  it(".vt-btn (view-toggle) meets 24x24 minimum", () => {
    const b = selectorBlock(".view-toggle .vt-btn");
    expect(readPx(b, "width")).toBeGreaterThanOrEqual(24);
    expect(readPx(b, "height")).toBeGreaterThanOrEqual(24);
  });

  it(".nav-kebab project actions meet 24x24 minimum (Ia2 inline fix)", () => {
    const b = selectorBlock(".nav-item-wrap .nav-kebab");
    expect(readPx(b, "width")).toBeGreaterThanOrEqual(24);
    expect(readPx(b, "height")).toBeGreaterThanOrEqual(24);
  });
});

describe("Ia2 · WCAG 2.4.11 focus-not-obscured · 2.5.7 dragging-movements", () => {
  it("chrome header is grid-area positioned (not sticky/fixed) — focus cannot be hidden behind it", () => {
    const block = (() => {
      const m = css.match(/^\.chrome\s*\{[\s\S]*?\n\}/m);
      if (!m) throw new Error("chrome block not found");
      return m[0];
    })();
    expect(block).toContain("grid-area: chrome");
    expect(block).not.toMatch(/position:\s*sticky/);
    expect(block).not.toMatch(/position:\s*fixed/);
  });

  it("no drag-only interactions in App-shell (sidebar/grid/drawer)", () => {
    expect(appTsx).not.toMatch(/onDragStart=\{/);
    expect(appTsx).not.toMatch(/draggable=\{?true\}?/);
  });
});
