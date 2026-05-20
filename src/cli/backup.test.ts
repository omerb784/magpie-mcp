// v0.9.3 Phase H · backup CLI tests.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupHome } from "./backup.js";

let WORK = "";
let HOME = "";
let OUT_DIR = "";

beforeEach(() => {
  WORK = path.join(
    tmpdir(),
    `magpie-backup-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  HOME = path.join(WORK, ".magpie");
  OUT_DIR = path.join(WORK, "out");
  mkdirSync(HOME, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
});

function seedFixtureHome(): { files: Record<string, Buffer>; skipped: string[] } {
  // Mix of file shapes — binary, multi-block, sub-dirs, edge sizes.
  const files: Record<string, Buffer> = {
    "magpie.db": Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0x01, 0x02, 0x03]),
    "blobs/abc123/v1.html": Buffer.from("<!doctype html><body>hi</body>", "utf8"),
    "blobs/abc123/v2.html": Buffer.alloc(513, 0x41), // forces 2 tar data blocks
    "blobs/abc123/v3.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "blobs/xyz789/v1.svg": Buffer.from("<svg/>", "utf8"),
    "thumbs/abc123/v1.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    "config.json": Buffer.from('{"hello":"world"}', "utf8"),
  };
  for (const [rel, buf] of Object.entries(files)) {
    const abs = path.join(HOME, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
  // Files that MUST be filtered out of the tar.
  writeFileSync(path.join(HOME, "magpie.lock"), '{"pid":1234}');
  writeFileSync(path.join(HOME, "magpie.lock~"), "leftover");
  writeFileSync(path.join(HOME, ".magpie-port"), "3737");
  return { files, skipped: ["magpie.lock", "magpie.lock~", ".magpie-port"] };
}

function walkRel(absRoot: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  const recur = (cur: string, prefix: string) => {
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) recur(abs, rel);
      else if (ent.isFile()) out[rel] = readFileSync(abs);
    }
  };
  recur(absRoot, "");
  return out;
}

// Run tar from the archive's own dir with RELATIVE paths so neither a drive
// colon (C:\...) nor the tar flavor matters: GNU tar reads "C:" as a remote
// host (would need --force-local), while Windows bsd-tar rejects --force-local
// outright. Going relative side-steps both — works on bsd-tar, GNU tar, Linux.
function runTarExtract(archivePath: string, into: string, gz: boolean): void {
  mkdirSync(into, { recursive: true });
  const cwd = path.dirname(archivePath);
  const archiveRel = path.basename(archivePath);
  const intoRel = path.relative(cwd, into);
  const flag = gz ? "-xzf" : "-xf";
  const r = spawnSync("tar", [flag, archiveRel, "-C", intoRel], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar ${flag} failed: status=${r.status} stderr=${r.stderr}`);
}

function extractTar(tarPath: string, into: string): void {
  runTarExtract(tarPath, into, false);
}

function extractTarGz(tarGzPath: string, into: string): void {
  runTarExtract(tarGzPath, into, true);
}

describe("backupHome", () => {
  it("tars a fixture MAGPIE_HOME byte-exact · skips lock + port files", async () => {
    const { files, skipped } = seedFixtureHome();
    const out = path.join(OUT_DIR, "snap.tar");

    const r = await backupHome({ home: HOME, output: out });
    expect(r.status).toBe("ok");
    expect(r.exitCode).toBe(0);
    expect(r.bytesWritten).toBeGreaterThan(0);
    expect(statSync(out).size).toBe(r.bytesWritten);

    const ext = path.join(OUT_DIR, "extracted");
    extractTar(out, ext);

    const top = readdirSync(ext);
    expect(top).toEqual([path.basename(HOME)]);
    const got = walkRel(path.join(ext, path.basename(HOME)));

    for (const [rel, buf] of Object.entries(files)) {
      expect(got[rel], `missing ${rel}`).toBeTruthy();
      expect(Buffer.compare(got[rel]!, buf), `bytes differ for ${rel}`).toBe(0);
    }
    for (const name of skipped) {
      expect(got[name], `${name} should have been skipped`).toBeUndefined();
    }
  }, 30_000);

  it("refuses to overwrite an existing target without --force", async () => {
    seedFixtureHome();
    const out = path.join(OUT_DIR, "snap.tar");
    writeFileSync(out, "pre-existing");
    const r = await backupHome({ home: HOME, output: out });
    expect(r.status).toBe("output-exists");
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/already exists/);
    expect(readFileSync(out, "utf8")).toBe("pre-existing");
  });

  it("--force overwrites an existing target", async () => {
    seedFixtureHome();
    const out = path.join(OUT_DIR, "snap.tar");
    writeFileSync(out, "pre-existing");
    const r = await backupHome({ home: HOME, output: out, force: true });
    expect(r.status).toBe("ok");
    expect(r.exitCode).toBe(0);
    expect(statSync(out).size).toBeGreaterThan(100);
  });

  it("--gzip produces a gz-encoded archive", async () => {
    const { files } = seedFixtureHome();
    const out = path.join(OUT_DIR, "snap.tar.gz");
    const r = await backupHome({ home: HOME, output: out, gzip: true });
    expect(r.status).toBe("ok");

    // gzip magic 1f 8b
    const head = readFileSync(out).subarray(0, 2);
    expect(head[0]).toBe(0x1f);
    expect(head[1]).toBe(0x8b);

    const ext = path.join(OUT_DIR, "extracted-gz");
    extractTarGz(out, ext);
    const got = walkRel(path.join(ext, path.basename(HOME)));
    for (const [rel, buf] of Object.entries(files)) {
      expect(Buffer.compare(got[rel]!, buf), `gz bytes differ for ${rel}`).toBe(0);
    }
  }, 30_000);

  it("home-missing errors when MAGPIE_HOME does not exist", async () => {
    rmSync(HOME, { recursive: true, force: true });
    const out = path.join(OUT_DIR, "snap.tar");
    const r = await backupHome({ home: HOME, output: out });
    expect(r.status).toBe("home-missing");
    expect(r.exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it("output-parent-missing errors when parent dir is absent", async () => {
    seedFixtureHome();
    const out = path.join(WORK, "no-such-dir", "snap.tar");
    const r = await backupHome({ home: HOME, output: out });
    expect(r.status).toBe("output-parent-missing");
    expect(r.exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
  });
});
