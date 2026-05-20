import { realpathSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { config } from "../config.js";

export type PathGuardErrCode =
  | "relative"
  | "outside_root"
  | "not_found"
  | "not_file"
  | "too_big"
  | "read_failed";

export interface PathGuardOk {
  ok: true;
  content: string;
  resolved_path: string;
}
export interface PathGuardErr {
  ok: false;
  code: PathGuardErrCode;
  message: string;
}
export type PathGuardResult = PathGuardOk | PathGuardErr;

export function readContentPath(input: string): PathGuardResult {
  if (!isAbsolute(input)) {
    return {
      ok: false,
      code: "relative",
      message: `content_path must be absolute. Got "${input}". Caller cwd and server cwd may differ over stdio — pass an absolute path.`,
    };
  }

  const root = config.contentRoot;
  let resolved: string;
  try {
    resolved = realpathSync(input);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return {
        ok: false,
        code: "not_found",
        message: `content_path "${input}" does not exist on disk.`,
      };
    }
    return {
      ok: false,
      code: "read_failed",
      message: `failed to resolve content_path: ${e.message ?? String(err)}`,
    };
  }

  if (!isUnderRoot(resolved, root)) {
    return {
      ok: false,
      code: "outside_root",
      message: `content_path "${input}" resolves to "${resolved}", which is outside the allowed content root "${root}". Set MAGPIE_CONTENT_ROOT to widen the gate, or move the file under the project root.`,
    };
  }

  let stat;
  try {
    stat = statSync(resolved);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      ok: false,
      code: "read_failed",
      message: `stat failed for resolved path "${resolved}": ${e.message ?? String(err)}`,
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      code: "not_file",
      message: `content_path "${resolved}" is not a regular file (directory, symlink loop, or special file).`,
    };
  }

  if (stat.size > config.maxContentBytes) {
    return {
      ok: false,
      code: "too_big",
      message: `content_path "${resolved}" is ${stat.size} bytes, exceeds limit of ${config.maxContentBytes}. Trim it or split into multiple visuals.`,
    };
  }

  let content: string;
  try {
    content = readFileSync(resolved, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      ok: false,
      code: "read_failed",
      message: `failed to read content_path "${resolved}": ${e.message ?? String(err)}`,
    };
  }

  return { ok: true, content, resolved_path: resolved };
}

function isUnderRoot(candidate: string, root: string): boolean {
  const rootResolved = resolve(root);
  if (candidate === rootResolved) return true;
  const rel = relative(rootResolved, candidate);
  if (rel === "" ) return true;
  if (rel.startsWith("..")) return false;
  if (isAbsolute(rel)) return false;
  return !rel.split(sep).some((seg) => seg === "..");
}
