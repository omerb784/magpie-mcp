import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");
const appTsx = readFileSync(join(here, "App.tsx"), "utf8");

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTsx(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("Ia3 · landmark roles + accessible names", () => {
  it("App-shell has <header>, <main>, <aside> landmarks", () => {
    expect(appTsx).toMatch(/<header className="chrome">/);
    expect(appTsx).toMatch(/<main className="main"[^>]*aria-label=/);
    expect(appTsx).toMatch(/<aside\s+className="sidebar"[^>]*aria-label=/);
  });

  it("sidebar landmark is named (aria-label asserts navigation purpose)", () => {
    const idx = appTsx.indexOf('className="sidebar"');
    const win = appTsx.slice(idx - 200, idx + 200);
    expect(win).toMatch(/aria-label="Project navigation"/);
  });

  it("main landmark is named (aria-label asserts library purpose)", () => {
    const idx = appTsx.indexOf('<main className="main"');
    const win = appTsx.slice(idx, idx + 200);
    expect(win).toMatch(/aria-label="Library"/);
  });
});

describe("Ia3 · form input labelling", () => {
  it("chrome search input has aria-label", () => {
    const idx = appTsx.indexOf('ref={searchInputRef}');
    expect(idx).toBeGreaterThan(0);
    const win = appTsx.slice(idx - 300, idx + 300);
    expect(win).toMatch(/aria-label="Search visuals, projects, tags"/);
  });

  it("project rename input has aria-label", () => {
    const idx = appTsx.indexOf('className="rename-input"');
    const win = appTsx.slice(idx - 200, idx + 400);
    expect(win).toMatch(/aria-label=\{?`?Rename project /);
  });

  it("drawer title rename input has aria-label", () => {
    const idx = appTsx.indexOf('className="drawer-title-input"');
    const win = appTsx.slice(idx - 200, idx + 200);
    expect(win).toMatch(/aria-label="Visual title"/);
  });

  it("drawer description textarea has aria-label", () => {
    const idx = appTsx.indexOf('className="drawer-description-input"');
    const win = appTsx.slice(idx - 200, idx + 200);
    expect(win).toMatch(/aria-label="Visual description"/);
  });

  it("tag input has aria-label", () => {
    const idx = appTsx.indexOf('className="tag-input"');
    const win = appTsx.slice(idx - 200, idx + 200);
    expect(win).toMatch(/aria-label="New tag name"/);
  });

  it("download version select is labelled via htmlFor pair", () => {
    const idx = appTsx.indexOf('id="download-version-select"');
    expect(idx).toBeGreaterThan(0);
    const win = appTsx.slice(idx - 400, idx + 200);
    expect(win).toMatch(/htmlFor="download-version-select"/);
  });

  it("copy-fallback textarea has aria-label", () => {
    const idx = appTsx.indexOf('className="copy-fallback-text"');
    const win = appTsx.slice(idx - 100, idx + 300);
    expect(win).toMatch(/aria-label="Prompt to copy"/);
  });

  it("archived-projects filter input has aria-label (pre-existing)", () => {
    const idx = appTsx.indexOf('Filter archived projects by name');
    const win = appTsx.slice(idx - 400, idx + 300);
    expect(win).toMatch(/aria-label="Filter archived projects"/);
  });
});

describe("Ia3 · WS-driven aria-live region", () => {
  it("toast-stack container is aria-live=polite + aria-atomic=false", () => {
    const idx = appTsx.indexOf('className="toast-stack"');
    const win = appTsx.slice(idx - 100, idx + 300);
    expect(win).toMatch(/aria-live="polite"/);
    expect(win).toMatch(/aria-atomic="false"/);
  });

  it("each toast item has role=status", () => {
    const idx = appTsx.indexOf("toasts.map((t)");
    expect(idx).toBeGreaterThan(0);
    const win = appTsx.slice(idx, idx + 600);
    expect(win).toMatch(/role="status"/);
  });
});

describe("Ia3 · reduced-motion shim", () => {
  it("index.css declares @media (prefers-reduced-motion: reduce)", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("reduced-motion block short-circuits --dur-* tokens to 0ms", () => {
    const idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThan(0);
    const block = css.slice(idx, idx + 700);
    expect(block).toMatch(/--dur-fast:\s*0ms/);
    expect(block).toMatch(/--dur-med:\s*0ms/);
    expect(block).toMatch(/--dur-slow:\s*0ms/);
    expect(block).toMatch(/--dur-grand:\s*0ms/);
  });

  it("reduced-motion block neutralises animation + transition durations universally", () => {
    const idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const block = css.slice(idx, idx + 700);
    expect(block).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});

describe("Ia3 · semantic HTML — no div+onClick fossils acting as buttons", () => {
  it("every div+onClick is either a dismiss/wrapper pattern OR has role=button + tabIndex", () => {
    const tsxFiles = walkTsx(here);
    for (const file of tsxFiles) {
      const text = readFileSync(file, "utf8");
      const re = /<div\b[^>]*\sonClick=[\s\S]*?(?:\/>|>)/g;
      const matches = text.match(re) ?? [];
      for (const m of matches) {
        const i = text.indexOf(m);
        const surround = text.slice(i, i + 400);
        const okBackdrop = m.includes("modal-backdrop");
        const okStopProp = surround.includes("e.stopPropagation()");
        const okCtxMenu = m.includes("ctx-menu");
        const okRoleButton = /role="button"[\s\S]*?tabIndex=\{?0\}?/.test(m);
        const isContainerNotButton = okBackdrop || okStopProp || okCtxMenu;
        const ok = isContainerNotButton || okRoleButton;
        expect(ok, `div+onClick acting as a button without role/tabIndex in ${file}: ${m.slice(0, 200)}`).toBe(true);
      }
    }
  });
});
