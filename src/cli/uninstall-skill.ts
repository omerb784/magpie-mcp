import { existsSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type UninstallStatus = "removed" | "noop-missing" | "error";

export interface UninstallResult {
  status: UninstallStatus;
  target: string;
  message: string;
  exitCode: number;
}

export interface UninstallOptions {
  /** Override the user's home dir (test fixture). Default: os.homedir(). */
  home?: string;
}

const SKILL_TARGET_REL = ".claude/skills/magpie-master/SKILL.md";

export function uninstallSkill(options: UninstallOptions = {}): UninstallResult {
  const home = options.home ?? homedir();
  const target = resolve(home, SKILL_TARGET_REL);

  if (!existsSync(target)) {
    return {
      status: "noop-missing",
      target,
      message: `magpie-master skill not installed at ${target} — nothing to uninstall.`,
      exitCode: 0,
    };
  }

  try {
    unlinkSync(target);
  } catch (err) {
    return {
      status: "error",
      target,
      message: `Failed to remove ${target}: ${(err as Error).message}`,
      exitCode: 1,
    };
  }

  // Remove the parent skill dir only if empty — leave any sibling files
  // (e.g. user-authored notes) untouched. Walk up one level: the
  // magpie-master/ dir is ours; ~/.claude/skills/ is shared.
  const skillDir = dirname(target);
  try {
    if (existsSync(skillDir) && readdirSync(skillDir).length === 0) {
      rmdirSync(skillDir);
    }
  } catch {
    // Non-fatal — SKILL.md is the load-bearing remove.
  }

  return {
    status: "removed",
    target,
    message: `Removed magpie-master skill from ${target}.`,
    exitCode: 0,
  };
}
