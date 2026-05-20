import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_PATH = resolve(__dirname, "../../skill/magpie-master/SKILL.md");
const PKG_PATH = resolve(__dirname, "../../package.json");

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter delimited by ---");
  const block = match[1];
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv) continue;
    out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe("skill/magpie-master/SKILL.md (v0.9.1 Phase A)", () => {
  it("file exists at the expected path", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("frontmatter parses with required fields", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("magpie-master");
    expect(fm.description).toBeTruthy();
    expect(fm.version).toBeTruthy();
  });

  it("description contains the locked tight triggers", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const fm = parseFrontmatter(content);
    for (const trigger of ["magpie", "magpie-mcp", "add_visual", "iterate"]) {
      expect(fm.description).toContain(trigger);
    }
  });

  it("version is lockstep with package.json", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const fm = parseFrontmatter(content);
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
    expect(fm.version).toBe(pkg.version);
  });

  it("body covers the six canonical scenes + six anti-patterns", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    for (let i = 1; i <= 6; i++) {
      expect(content).toMatch(new RegExp(`Scene ${i}`));
    }
    expect(content).toMatch(/anti-pattern/i);
  });

  it("includes the four-actor framing", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    for (const actor of ["master", "magpie", "nest", "Owner"]) {
      expect(content).toContain(actor);
    }
  });
});
