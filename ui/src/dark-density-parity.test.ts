import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "index.css"), "utf8");

describe("Ib3 · dark theme · paired-token coverage", () => {
  it("every core color token has a -d dark variant", () => {
    const paired: Array<[string, string]> = [
      ["--ink", "--ink-d"],
      ["--paper", "--paper-d"],
      ["--mid", "--mid-d"],
      ["--light", "--light-d"],
      ["--hairline", "--hairline-d"],
      ["--hairline-strong", "--hairline-d-strong"],
    ];
    for (const [, dark] of paired) {
      expect(css, `expected ${dark} declaration in :root`).toMatch(
        new RegExp(`${dark.replace(/-/g, "\\-")}:\\s*`),
      );
    }
  });

  it("every theme-mapped surface has a body[data-theme] override", () => {
    expect(css).toMatch(/body\[data-theme="light"\]/);
    expect(css).toMatch(/body\[data-theme="dark"\]/);
    const lightBlock = css.match(/body\[data-theme="light"\]\s*\{[\s\S]*?\n\}/)![0];
    const darkBlock = css.match(/body\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/)![0];
    const expected = ["--bg", "--surface", "--surface-2", "--surface-3", "--text", "--text-mute", "--text-subtle", "--shadow", "--thumb-bg", "--badge-bg", "--badge-fg"];
    for (const tk of expected) {
      const re = new RegExp(`${tk.replace(/-/g, "\\-")}:`);
      expect(lightBlock, `light missing ${tk}`).toMatch(re);
      expect(darkBlock, `dark missing ${tk}`).toMatch(re);
    }
  });

  it("render-badge has dark-theme parity (Ib3 inline fix)", () => {
    expect(css).toMatch(/body\[data-theme="dark"\] \.render-badge\.ok\b/);
    expect(css).toMatch(/body\[data-theme="dark"\] \.render-badge\.warn\b/);
    expect(css).toMatch(/body\[data-theme="dark"\] \.render-badge\.failed\b/);
  });

  it("toast.success/error icons have dark-theme parity (Ib3 inline fix)", () => {
    expect(css).toMatch(/body\[data-theme="dark"\] \.toast\.success \.toast-icon\b/);
    expect(css).toMatch(/body\[data-theme="dark"\] \.toast\.error \.toast-icon\b/);
  });
});

describe("Ib3 · density mode · selector inventory", () => {
  it("data-density=compact rules exist for shell + card-grid", () => {
    const compactRules = (css.match(/body\[data-density="compact"\]/g) ?? []).length;
    expect(compactRules).toBeGreaterThanOrEqual(5);
    expect(css).toMatch(/body\[data-density="compact"\] \.shell\b/);
    expect(css).toMatch(/body\[data-density="compact"\] \.card-grid\b/);
  });
});
