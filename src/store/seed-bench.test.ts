import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "seed-bench.mjs");

let home: string;

// Use a raw better-sqlite3 handle pointed at the per-test home. The store's
// getDb() resolves dbPath via config at module-init time (vitest.setup pins
// MAGPIE_HOME once), so it would read the wrong file here.
function openTestDb() {
  return new Database(join(home, "db.sqlite"), { readonly: true });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "magpie-seed-bench-"));
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

function runScript(args: string[] = []): {
  status: number | null;
  stdout: string;
  stderr: string;
  json: ReturnType<typeof JSON.parse> | null;
} {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, MAGPIE_HOME: home },
    encoding: "utf8",
  });
  let json: ReturnType<typeof JSON.parse> | null = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

describe("seed-bench script", () => {
  it("seeds 20 projects + 1000 visuals + tags + versions in < 10s", () => {
    const r = runScript(["--json"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json?.status).toBe("ok");
    expect(r.json?.projectsInserted).toBe(20);
    expect(r.json?.visualsInserted).toBe(1000);
    expect(r.json?.tagsInserted).toBe(30);
    // Skewed 1-5 distribution, expected mean ~1.83 → ~1830 versions. Allow band.
    expect(r.json?.versionsInserted).toBeGreaterThanOrEqual(1500);
    expect(r.json?.versionsInserted).toBeLessThanOrEqual(2500);
    expect(r.json?.elapsedMs).toBeLessThan(10_000);
  });

  it("is idempotent — re-run without --reset skips", () => {
    const first = runScript(["--json"]);
    expect(first.status).toBe(0);
    expect(first.json?.status).toBe("ok");

    const second = runScript(["--json"]);
    expect(second.status).toBe(0);
    expect(second.json?.status).toBe("skipped");
    expect(second.json?.marker).toBeTruthy();
  });

  it("--reset wipes seeded rows and re-seeds cleanly", () => {
    const first = runScript(["--json"]);
    expect(first.json?.status).toBe("ok");

    const reset = runScript(["--reset", "--json"]);
    expect(reset.status, reset.stderr).toBe(0);
    expect(reset.json?.status).toBe("ok");
    expect(reset.json?.reset?.rowsRemoved).toBe(1000);
    expect(reset.json?.reset?.blobsRemoved).toBe(1000);
    expect(reset.json?.visualsInserted).toBe(1000);
  });

  it("writes rows that match script summary and produces blob files", () => {
    runScript(["--json"]);

    const db = openTestDb();
    try {
      const projects = db.prepare("SELECT COUNT(*) c FROM projects").get() as { c: number };
      const visuals = db.prepare("SELECT COUNT(*) c FROM visuals").get() as { c: number };
      const versions = db.prepare("SELECT COUNT(*) c FROM versions").get() as { c: number };
      const visualTags = db.prepare("SELECT COUNT(*) c FROM visual_tags").get() as { c: number };

      expect(projects.c).toBe(20);
      expect(visuals.c).toBe(1000);
      expect(versions.c).toBeGreaterThanOrEqual(1500);
      expect(visualTags.c).toBeGreaterThanOrEqual(3000);

      const sampleVersion = db
        .prepare("SELECT content_path FROM versions LIMIT 1")
        .get() as { content_path: string };
      expect(existsSync(sampleVersion.content_path)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("namespaces tags so --reset does not touch canonical seed tags from migration 002", () => {
    runScript(["--json"]);

    const db = openTestDb();
    const beforeCanonical = db
      .prepare("SELECT COUNT(*) c FROM tags WHERE name NOT LIKE 'seed-bench-tag-%'")
      .get() as { c: number };
    db.close();
    expect(beforeCanonical.c).toBeGreaterThan(0);

    const reset = runScript(["--reset", "--json"]);
    expect(reset.json?.status).toBe("ok");

    const db2 = openTestDb();
    const afterCanonical = db2
      .prepare("SELECT COUNT(*) c FROM tags WHERE name NOT LIKE 'seed-bench-tag-%'")
      .get() as { c: number };
    db2.close();
    expect(afterCanonical.c).toBe(beforeCanonical.c);
  });
});
