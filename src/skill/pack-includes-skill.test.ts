import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_PATH = resolve(__dirname, "../../package.json");

describe("npm pack includes skill/magpie-master/ (v1.0 boundary lock)", () => {
  it("package.json#files contains 'skill/magpie-master' (v1.0 — was bare 'skill' which leaked steward + security)", () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { files: string[] };
    expect(pkg.files).toContain("skill/magpie-master");
    expect(pkg.files).not.toContain("skill");
    expect(pkg.files).not.toContain("skill/magpie-steward");
    expect(pkg.files).not.toContain("skill/magpie-security");
  });

  it("files array still ships dist + README + LICENSE", () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { files: string[] };
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).toContain("LICENSE");
  });

  it("version matches the SKILL.md frontmatter version (lockstep)", () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version: string };
    const skill = readFileSync(
      resolve(__dirname, "../../skill/magpie-master/SKILL.md"),
      "utf8"
    );
    const m = skill.match(/^version:\s*(.+)$/m);
    expect(m).toBeTruthy();
    expect(m![1].trim()).toBe(pkg.version);
  });
});
