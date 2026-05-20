import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appTsx = readFileSync(join(here, "App.tsx"), "utf8");

function blockAfter(needle: string, lookback: number, lookahead: number): string {
  const idx = appTsx.indexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  const start = Math.max(0, idx - lookback);
  const end = Math.min(appTsx.length, idx + lookahead);
  return appTsx.slice(start, end);
}

describe("Ia1 · App-shell modal focus management static-probe", () => {
  it("confirm modal has role=dialog + aria-modal + tabIndex focus + Escape close", () => {
    const block = blockAfter('"modal confirm-modal"', 100, 1000);
    expect(block).toContain('role="dialog"');
    expect(block).toContain('aria-modal="true"');
    expect(block).toContain("tabIndex={-1}");
    expect(block).toMatch(/ref=\{\(el\)\s*=>\s*el\?\.focus\(\)/);
    expect(block).toContain('if (e.key === "Escape")');
  });

  it("cheatsheet overlay has role=dialog + aria-modal + accessible name + Escape close", () => {
    const block = blockAfter('className="cheatsheet"', 100, 800);
    expect(block).toContain('role="dialog"');
    expect(block).toContain('aria-modal="true"');
    expect(block).toContain('aria-label="Keyboard shortcuts"');
    expect(block).toContain("tabIndex={-1}");
    expect(block).toMatch(/ref=\{\(el\)\s*=>\s*el\?\.focus\(\)/);
  });

  it("copy-fallback modal has role=dialog + aria-modal + tabIndex focus + Escape close", () => {
    const block = blockAfter('"modal copy-fallback"', 100, 1000);
    expect(block).toContain('role="dialog"');
    expect(block).toContain('aria-modal="true"');
    expect(block).toContain("tabIndex={-1}");
    expect(block).toContain('if (e.key === "Escape")');
  });

  it("export-zip modal has role=dialog + aria-modal + Escape close (Ia1 inline fix)", () => {
    const marker = `Export "{exportZipFor.name}" as zip`;
    const idx = appTsx.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    const block = appTsx.slice(idx - 800, idx);
    expect(block).toMatch(/role="dialog"/);
    expect(block).toMatch(/aria-modal="true"/);
    expect(block).toMatch(/e\.key === "Escape"/);
    expect(block).toMatch(/tabIndex=\{-1\}/);
  });

  it("merge-projects modal has role=dialog + aria-modal + Escape close (Ia1 inline fix)", () => {
    const marker = `Merge "{mergeModal.srcName}" into…`;
    const idx = appTsx.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    const block = appTsx.slice(idx - 800, idx);
    expect(block).toMatch(/role="dialog"/);
    expect(block).toMatch(/aria-modal="true"/);
    expect(block).toMatch(/e\.key === "Escape"/);
    expect(block).toMatch(/tabIndex=\{-1\}/);
  });

  it("toast-stack container is an aria-live polite region", () => {
    const idx = appTsx.indexOf("toast-stack");
    expect(idx).toBeGreaterThan(0);
    const block = appTsx.slice(idx - 200, idx + 200);
    expect(block).toMatch(/aria-live="polite"/);
    expect(block).toMatch(/aria-atomic="false"/);
  });

  it("sidebar <aside> has aria-label naming it as project navigation", () => {
    const idx = appTsx.indexOf('className="sidebar"');
    expect(idx).toBeGreaterThan(0);
    const block = appTsx.slice(idx - 400, idx + 400);
    expect(block).toMatch(/aria-label="(Projects|Project navigation|Library navigation|Sidebar)"/i);
  });

  it("<main> chrome region has aria-label", () => {
    const idx = appTsx.indexOf('<main className="main"');
    expect(idx).toBeGreaterThan(0);
    const block = appTsx.slice(idx, idx + 300);
    expect(block).toMatch(/aria-label="(Library|Main content|Visuals)"/i);
  });
});
