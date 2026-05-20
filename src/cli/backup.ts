// v0.9.3 Phase H — `magpie-mcp --backup <path>` CLI.
//
// Atomic-ish hot backup of MAGPIE_HOME (DB + blobs + skill + misc) as a
// POSIX USTAR tar stream, optionally gzipped. WAL is flushed via a
// read-only PRAGMA wal_checkpoint(FULL) best-effort before the walk so
// the tarred DB file is current; SQLite's WAL+SHM are also tarred so a
// crash mid-checkpoint still yields a recoverable snapshot.
//
// No new npm deps — USTAR encoder is inline (~110 lines), gzip via
// node:zlib.

import Database from "better-sqlite3";
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { createGzip } from "node:zlib";

export type BackupStatus =
  | "ok"
  | "home-missing"
  | "output-exists"
  | "output-parent-missing"
  | "error";

export interface BackupResult {
  status: BackupStatus;
  output: string;
  bytesWritten: number;
  durationMs: number;
  message: string;
  exitCode: number;
}

export interface BackupOptions {
  home: string;
  output: string;
  gzip?: boolean;
  force?: boolean;
}

const SKIP_NAMES = new Set([
  "magpie.lock",            // discovery file · per-process state
  "magpie.lock~",           // atomic-rename leftover
  "ipc.sock",               // POSIX IPC socket
  ".magpie-port",           // legacy last-port file
]);

export async function backupHome(opts: BackupOptions): Promise<BackupResult> {
  const start = Date.now();
  const { home, output } = opts;

  if (!existsSync(home)) {
    return {
      status: "home-missing",
      output,
      bytesWritten: 0,
      durationMs: Date.now() - start,
      message: `MAGPIE_HOME "${home}" does not exist on disk.`,
      exitCode: 1,
    };
  }
  if (!statSync(home).isDirectory()) {
    return {
      status: "error",
      output,
      bytesWritten: 0,
      durationMs: Date.now() - start,
      message: `MAGPIE_HOME "${home}" is not a directory.`,
      exitCode: 1,
    };
  }

  const parent = path.dirname(path.resolve(output));
  if (!existsSync(parent)) {
    return {
      status: "output-parent-missing",
      output,
      bytesWritten: 0,
      durationMs: Date.now() - start,
      message: `Output parent directory "${parent}" does not exist. Create it or choose a different path.`,
      exitCode: 1,
    };
  }
  if (existsSync(output) && !opts.force) {
    return {
      status: "output-exists",
      output,
      bytesWritten: 0,
      durationMs: Date.now() - start,
      message: `Backup target "${output}" already exists. Pass --force to overwrite.`,
      exitCode: 1,
    };
  }

  // Best-effort WAL checkpoint. Open read-only so we can't break a live
  // canonical's write path; PRAGMA wal_checkpoint(FULL) is a no-op if
  // the WAL is empty and harmless if it isn't.
  const dbPath = path.join(home, "magpie.db");
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        db.pragma("wal_checkpoint(FULL)");
      } finally {
        db.close();
      }
    } catch {
      /* best-effort — backup proceeds with whatever's on disk */
    }
  }

  const sink = createWriteStream(output);
  const top: Writable = opts.gzip ? (createGzip() as unknown as Writable) : sink;
  if (opts.gzip) {
    (top as unknown as { pipe: (w: Writable) => Writable }).pipe(sink);
  }

  const write = (chunk: Buffer): void => {
    top.write(chunk);
  };

  const homeAbs = path.resolve(home);
  const baseName = path.basename(homeAbs) || "magpie-home";
  walk(homeAbs, baseName, write);

  // USTAR end-of-archive: two zero blocks.
  write(Buffer.alloc(512));
  write(Buffer.alloc(512));

  await new Promise<void>((resolve, reject) => {
    sink.on("close", () => resolve());
    sink.on("error", (err) => reject(err));
    top.end();
  });

  const finalBytes = statSync(output).size;
  return {
    status: "ok",
    output: path.resolve(output),
    bytesWritten: finalBytes,
    durationMs: Date.now() - start,
    message: `Wrote backup to ${path.resolve(output)} (${finalBytes} bytes in ${Date.now() - start}ms).`,
    exitCode: 0,
  };
}

function walk(absDir: string, relPrefix: string, write: (b: Buffer) => void): void {
  const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  // Emit dir entry first.
  write(ustarHeader(relPrefix + "/", 0, "5", 0o755));

  for (const ent of entries) {
    if (SKIP_NAMES.has(ent.name)) continue;
    const abs = path.join(absDir, ent.name);
    const rel = `${relPrefix}/${ent.name}`;

    if (ent.isDirectory()) {
      walk(abs, rel, write);
      continue;
    }
    if (!ent.isFile()) continue; // skip symlinks / specials

    const data = readFileSync(abs);
    write(ustarHeader(rel, data.length, "0", 0o644));
    write(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) write(Buffer.alloc(pad));
  }
}

// POSIX USTAR header — 512 bytes, fields written as ASCII octal in
// fixed-width zero-padded slots, with trailing NUL/space per spec.
function ustarHeader(
  name: string,
  size: number,
  typeflag: "0" | "5",
  mode: number,
): Buffer {
  const buf = Buffer.alloc(512);

  // Name field is 100 bytes. For longer paths we'd need prefix; MAGPIE_HOME
  // paths fit well within 100 chars in practice, but split if needed.
  let nameField = name;
  let prefixField = "";
  if (Buffer.byteLength(nameField, "utf8") > 100) {
    const idx = name.lastIndexOf("/", 155);
    if (idx > 0 && Buffer.byteLength(name.slice(idx + 1), "utf8") <= 100) {
      prefixField = name.slice(0, idx);
      nameField = name.slice(idx + 1);
    } else {
      throw new Error(`tar: path too long for USTAR (>100 chars and no split point): ${name}`);
    }
  }

  buf.write(nameField, 0, 100, "utf8");
  buf.write(octal(mode, 7) + "\0", 100, 8, "utf8");        // mode
  buf.write(octal(0, 7) + "\0", 108, 8, "utf8");           // uid
  buf.write(octal(0, 7) + "\0", 116, 8, "utf8");           // gid
  buf.write(octal(size, 11) + "\0", 124, 12, "utf8");      // size
  buf.write(octal(Math.floor(Date.now() / 1000), 11) + "\0", 136, 12, "utf8"); // mtime
  buf.write("        ", 148, 8, "utf8");                   // checksum placeholder (spaces)
  buf.write(typeflag, 156, 1, "utf8");                     // typeflag
  // linkname (157, 100) left zero
  buf.write("ustar\0", 257, 6, "utf8");                    // magic
  buf.write("00", 263, 2, "utf8");                         // version
  // uname/gname/devmajor/devminor left zero
  if (prefixField) buf.write(prefixField, 345, 155, "utf8");

  // Compute checksum: sum of all bytes in the header, with the checksum
  // field treated as 8 spaces.
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i]!;
  buf.write(octal(sum, 6) + "\0 ", 148, 8, "utf8");

  return buf;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}
