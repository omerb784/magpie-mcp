#!/usr/bin/env node
// scripts/bump-version.mjs — R20 5-surface lockstep version bumper.
//
// Usage:
//   node scripts/bump-version.mjs <target-version> [--dry-run] [--force]
//
// Bumps the 5 surfaces that R20 requires to stay locked together:
//   1. package.json                              · top-level "version"
//   2. src/config.ts                             · exported VERSION const
//   3. skill/magpie-master/SKILL.md              · YAML frontmatter version:
//   4. skill/magpie-steward/SKILL.md             · YAML frontmatter version:
//   5. src/cli/install-skill.ts                  · in-line version reference (line ~98)
//
// Hand-editing these at T-0 is stressful + error-prone. This script:
//   - validates target matches semver (^\d+\.\d+\.\d+$)
//   - refuses to run on dirty surfaces (override with --force)
//   - is idempotent: surfaces already at target are reported + skipped
//   - --dry-run prints the plan without writing
//   - writes all surfaces, then re-reads + asserts; exits 1 on any mismatch
//   - prints a summary table (surface · old · new · status)
//
// Designed for v1.0/bump-script (Session E2 ship-prep).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Resolve the repo root from this script's location.
 * scripts/bump-version.mjs → repo root is one level up.
 * Allows override via env MAGPIE_BUMP_ROOT (used by tests).
 */
function resolveRoot() {
  if (process.env.MAGPIE_BUMP_ROOT) {
    return resolve(process.env.MAGPIE_BUMP_ROOT);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

/**
 * Each surface is a (path, read-current, replace-with-target) tuple.
 * read returns null when the version line is absent (treated as error).
 */
function makeSurfaces(root) {
  return [
    {
      name: "package.json",
      path: resolve(root, "package.json"),
      read(content) {
        const m = content.match(/"version":\s*"(\d+\.\d+\.\d+)"/);
        return m ? m[1] : null;
      },
      replace(content, target) {
        return content.replace(
          /("version":\s*")(\d+\.\d+\.\d+)(")/,
          `$1${target}$3`,
        );
      },
    },
    {
      name: "src/config.ts",
      path: resolve(root, "src/config.ts"),
      read(content) {
        const m = content.match(/export\s+const\s+VERSION\s*=\s*"(\d+\.\d+\.\d+)"/);
        return m ? m[1] : null;
      },
      replace(content, target) {
        return content.replace(
          /(export\s+const\s+VERSION\s*=\s*")(\d+\.\d+\.\d+)(")/,
          `$1${target}$3`,
        );
      },
    },
    {
      name: "skill/magpie-master/SKILL.md",
      path: resolve(root, "skill/magpie-master/SKILL.md"),
      read(content) {
        const m = content.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m);
        return m ? m[1] : null;
      },
      replace(content, target) {
        return content.replace(
          /^(version:\s*)(\d+\.\d+\.\d+)(\s*)$/m,
          `$1${target}$3`,
        );
      },
    },
    {
      name: "skill/magpie-steward/SKILL.md",
      path: resolve(root, "skill/magpie-steward/SKILL.md"),
      read(content) {
        const m = content.match(/^version:\s*(\d+\.\d+\.\d+)\s*$/m);
        return m ? m[1] : null;
      },
      replace(content, target) {
        return content.replace(
          /^(version:\s*)(\d+\.\d+\.\d+)(\s*)$/m,
          `$1${target}$3`,
        );
      },
    },
    {
      // The "v0.9.3" literal inside the unknown-host fallback message
      // (Cursor/Cline auto-install note). User-facing, must bump in lockstep
      // so a v1.0 install never claims "not supported in v0.9.3".
      name: "src/cli/install-skill.ts",
      path: resolve(root, "src/cli/install-skill.ts"),
      read(content) {
        const m = content.match(
          /Cursor \+ Cline auto-install not supported in v(\d+\.\d+\.\d+)/,
        );
        return m ? m[1] : null;
      },
      replace(content, target) {
        return content.replace(
          /(Cursor \+ Cline auto-install not supported in v)(\d+\.\d+\.\d+)/,
          `$1${target}`,
        );
      },
    },
  ];
}

function isGitDirty(filePath, root) {
  try {
    // `git diff --quiet -- <path>` exits 0 if clean, 1 if dirty.
    execFileSync("git", ["diff", "--quiet", "--", filePath], {
      cwd: root,
      stdio: "pipe",
    });
    // Also check staged but unflushed changes vs HEAD.
    execFileSync("git", ["diff", "--cached", "--quiet", "--", filePath], {
      cwd: root,
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

function padRight(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printTable(rows) {
  const headers = ["surface", "old", "new", "status"];
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      widths[i] = Math.max(widths[i], String(row[i]).length);
    }
  }
  const fmt = (row) =>
    row.map((cell, i) => padRight(String(cell), widths[i])).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(fmt(row));
}

function parseArgs(argv) {
  const args = { dryRun: false, force: false, target: null };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (args.target === null) {
      args.target = a;
    } else {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(
      "Usage: node scripts/bump-version.mjs <target-version> [--dry-run] [--force]",
    );
    process.exit(2);
  }

  if (!args.target) {
    console.error(
      "Missing target version. Usage: node scripts/bump-version.mjs <target-version> [--dry-run] [--force]",
    );
    process.exit(2);
  }

  if (!SEMVER.test(args.target)) {
    console.error(
      `Invalid version: ${args.target}. Expected MAJOR.MINOR.PATCH (e.g. 1.0.0).`,
    );
    process.exit(2);
  }

  const root = resolveRoot();
  const surfaces = makeSurfaces(root);

  // Pre-flight: read current state + check git cleanliness.
  const plans = [];
  for (const surface of surfaces) {
    let content;
    try {
      content = readFileSync(surface.path, "utf8");
    } catch (err) {
      console.error(`Cannot read ${surface.name}: ${err.message}`);
      process.exit(1);
    }
    const current = surface.read(content);
    if (current === null) {
      console.error(
        `Cannot locate version in ${surface.name}. Update bump-version.mjs to match the new layout.`,
      );
      process.exit(1);
    }
    plans.push({ surface, content, current });
  }

  if (!args.force && !args.dryRun) {
    const dirty = [];
    for (const { surface } of plans) {
      if (isGitDirty(surface.path, root)) dirty.push(surface.name);
    }
    if (dirty.length > 0) {
      console.error(
        `Refusing to bump — these surfaces have uncommitted changes:\n  - ${dirty.join("\n  - ")}\nCommit or stash, or re-run with --force.`,
      );
      process.exit(1);
    }
  }

  const rows = [];
  const writes = [];
  for (const { surface, content, current } of plans) {
    if (current === args.target) {
      rows.push([surface.name, current, args.target, "noop"]);
      continue;
    }
    const next = surface.replace(content, args.target);
    if (next === content) {
      console.error(
        `Replace produced no change for ${surface.name} — regex is out of sync with the file.`,
      );
      process.exit(1);
    }
    writes.push({ surface, next });
    rows.push([
      surface.name,
      current,
      args.target,
      args.dryRun ? "planned" : "bumped",
    ]);
  }

  if (args.dryRun) {
    console.log(`[dry-run] target ${args.target} — no files written\n`);
    printTable(rows);
    process.exit(0);
  }

  for (const { surface, next } of writes) {
    writeFileSync(surface.path, next, "utf8");
  }

  // Verify: re-read every surface, assert it now equals target.
  const mismatches = [];
  for (const { surface } of plans) {
    const content = readFileSync(surface.path, "utf8");
    const after = surface.read(content);
    if (after !== args.target) {
      mismatches.push(`${surface.name}: expected ${args.target}, got ${after}`);
    }
  }
  if (mismatches.length > 0) {
    console.error(
      `Post-write verification failed:\n  - ${mismatches.join("\n  - ")}`,
    );
    process.exit(1);
  }

  console.log(`Bumped ${writes.length} of ${plans.length} surfaces to ${args.target}.\n`);
  printTable(rows);
  process.exit(0);
}

main();
