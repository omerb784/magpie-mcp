import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type InstallStatus =
  | "copied"
  | "noop-same"
  | "upgraded"
  | "downgrade-warn"
  | "refused-edited"
  | "unknown-host"
  | "error";

export interface InstallResult {
  status: InstallStatus;
  target: string;
  bundled: string;
  message: string;
  exitCode: number;
}

export interface InstallOptions {
  /** Override the user's home dir (test fixture). Default: os.homedir(). */
  home?: string;
  /** When true, overwrite even if installed differs from bundled. */
  force?: boolean;
  /** Override the bundled SKILL.md path (test fixture). Default: resolved from this module. */
  bundledPath?: string;
}

const SKILL_REL = "skill/magpie-master/SKILL.md";
const SKILL_TARGET_REL = ".claude/skills/magpie-master/SKILL.md";

function resolveBundledPath(): string {
  // From src/cli/install-skill.ts → ../../skill/magpie-master/SKILL.md
  // After build, dist/cli/install-skill.js → ../../skill/magpie-master/SKILL.md
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", SKILL_REL);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseVersion(content: string): string | null {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const body = fm?.[1];
  if (!body) return null;
  const m = body.match(/^version:\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function compareVersions(a: string, b: string): number {
  const ap = a.split(".").map((n) => Number.parseInt(n, 10));
  const bp = b.split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const x = ap[i] ?? 0;
    const y = bp[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function installSkill(options: InstallOptions = {}): InstallResult {
  const home = options.home ?? homedir();
  const bundledPath = options.bundledPath ?? resolveBundledPath();
  const target = resolve(home, SKILL_TARGET_REL);

  if (!existsSync(bundledPath)) {
    return {
      status: "error",
      target,
      bundled: bundledPath,
      message: `Bundled skill not found at ${bundledPath}. This indicates a broken install — reinstall magpie-mcp.`,
      exitCode: 1,
    };
  }

  const bundledContent = readFileSync(bundledPath, "utf8");

  // Unknown-host: ~/.claude/ does not exist → Claude Code not installed (or not in default location).
  // Print target paths + bundled content so the Owner can install manually.
  if (!existsSync(resolve(home, ".claude"))) {
    return {
      status: "unknown-host",
      target,
      bundled: bundledPath,
      message: [
        `Claude Code not detected at ${resolve(home, ".claude")}.`,
        "",
        `To install the master skill manually, copy ${bundledPath}`,
        `to: ${target}`,
        "",
        "(Cursor + Cline auto-install not supported in v0.9.3 — manual copy works for any host that reads SKILL.md.)",
      ].join("\n"),
      exitCode: 0,
    };
  }

  // Existing target: decide copy / noop / refuse based on hash + version.
  if (existsSync(target)) {
    const installedContent = readFileSync(target, "utf8");
    if (sha256(installedContent) === sha256(bundledContent)) {
      return {
        status: "noop-same",
        target,
        bundled: bundledPath,
        message: `magpie-master skill already up to date at ${target}.`,
        exitCode: 0,
      };
    }
    // Differ — check versions.
    const installedVersion = parseVersion(installedContent);
    const bundledVersion = parseVersion(bundledContent);
    const versionCmp =
      installedVersion !== null && bundledVersion !== null
        ? compareVersions(installedVersion, bundledVersion)
        : null;
    const isUpgrade = versionCmp !== null && versionCmp < 0;
    const isDowngrade = versionCmp !== null && versionCmp > 0;

    if (isUpgrade) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bundledContent, "utf8");
      return {
        status: "upgraded",
        target,
        bundled: bundledPath,
        message: `Upgraded magpie-master skill ${installedVersion} → ${bundledVersion} at ${target}.`,
        exitCode: 0,
      };
    }

    // Installed version is newer than bundled — likely the Owner is running
    // an older magpie-mcp against a skill installed by a newer one (or the
    // skill frontmatter has been hand-bumped). Skip overwrite by default;
    // --force still works the same as it does for refused-edited.
    if (isDowngrade && !options.force) {
      return {
        status: "downgrade-warn",
        target,
        bundled: bundledPath,
        message: [
          `magpie-master skill at ${target} is newer than the bundled copy.`,
          `  Installed version: ${installedVersion}  ·  Bundled version: ${bundledVersion}`,
          "",
          "Leaving the installed copy untouched. To force a downgrade (your newer skill will be lost):",
          "  npx magpie-mcp --install-skill --force",
        ].join("\n"),
        exitCode: 0,
      };
    }

    if (!options.force) {
      return {
        status: "refused-edited",
        target,
        bundled: bundledPath,
        message: [
          `magpie-master skill at ${target} differs from bundled.`,
          installedVersion && bundledVersion
            ? `  Installed version: ${installedVersion}  ·  Bundled version: ${bundledVersion}`
            : "",
          "",
          "Looks hand-edited or modified. Refusing to overwrite without --force.",
          "",
          "Inspect the diff:",
          `  diff "${target}" "${bundledPath}"`,
          "",
          "Or force overwrite (your edits will be lost):",
          "  npx magpie-mcp --install-skill --force",
        ]
          .filter(Boolean)
          .join("\n"),
        exitCode: 1,
      };
    }

    // Force-overwrite.
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bundledContent, "utf8");
    return {
      status: "copied",
      target,
      bundled: bundledPath,
      message: `Forced overwrite of magpie-master skill at ${target}.`,
      exitCode: 0,
    };
  }

  // Missing target: copy.
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bundledContent, "utf8");
  return {
    status: "copied",
    target,
    bundled: bundledPath,
    message: `Installed magpie-master skill at ${target}.`,
    exitCode: 0,
  };
}
