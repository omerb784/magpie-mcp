import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RENDER_DIR = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "https URL", pattern: /https:\/\/[\w.-]+/g },
  { name: "cdn.jsdelivr.net", pattern: /cdn\.jsdelivr\.net/g },
  { name: "unpkg.com", pattern: /unpkg\.com/g },
  { name: "jspm.io", pattern: /jspm\.io/g },
  { name: "esm.sh", pattern: /esm\.sh/g },
  { name: "cdnjs.cloudflare.com", pattern: /cdnjs\.cloudflare\.com/g },
];

function renderSourceFiles(): string[] {
  return readdirSync(RENDER_DIR)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts"))
    .map((f) => join(RENDER_DIR, f));
}

describe("R7 · no CDN hosts in render runtime paths (F5a static grep)", () => {
  it("enumerates render source files", () => {
    const files = renderSourceFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    it(`forbids ${name} in any render source file`, () => {
      const offenders: { file: string; matches: string[] }[] = [];
      for (const file of renderSourceFiles()) {
        const content = readFileSync(file, "utf8");
        const matches = content.match(pattern);
        if (matches && matches.length > 0) {
          offenders.push({ file, matches });
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
