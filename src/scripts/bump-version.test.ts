// scripts/bump-version.mjs tests. Mirror the R20 5-surface lockstep contract
// by spawning the real script against a tmp-dir copy of each surface — never
// mutates the actual repo files.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/bump-version.mjs");

const SURFACES = [
  "package.json",
  "src/config.ts",
  "skill/magpie-master/SKILL.md",
  "skill/magpie-steward/SKILL.md",
  "src/cli/install-skill.ts",
];

interface Fixture {
  root: string;
  cleanup: () => void;
}

/**
 * Build a tmp repo skeleton containing just the 5 surface files seeded with
 * a known starting version. Also runs `git init` + commit so the dirty-guard
 * has a baseline to compare against.
 */
function buildFixture(startVersion: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "magpie-bump-"));

  const writeAt = (rel: string, body: string) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  };

  writeAt(
    "package.json",
    JSON.stringify(
      { name: "magpie-mcp", version: startVersion, type: "module" },
      null,
      2,
    ) + "\n",
  );
  writeAt(
    "src/config.ts",
    `// header\nexport const VERSION = "${startVersion}";\nexport const OTHER = 1;\n`,
  );
  writeAt(
    "skill/magpie-master/SKILL.md",
    `---\nname: magpie-master\ndescription: demo\nversion: ${startVersion}\n---\n\nbody\n`,
  );
  writeAt(
    "skill/magpie-steward/SKILL.md",
    `---\nname: magpie-steward\ndescription: demo\nversion: ${startVersion}\n---\n\nbody\n`,
  );
  writeAt(
    "src/cli/install-skill.ts",
    `// stub\nexport const MSG = "(Cursor + Cline auto-install not supported in v${startVersion} — manual copy works.)";\n`,
  );

  // git init + initial commit so dirty-guard has a baseline.
  const git = (args: string[]) =>
    spawnSync("git", args, {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init", "--no-gpg-sign"]);

  return {
    root,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows file-lock flake — ignore.
      }
    },
  };
}

function runBump(root: string, args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    env: { ...process.env, MAGPIE_BUMP_ROOT: root },
    encoding: "utf8",
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function readSurfaceVersions(root: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const rel of SURFACES) {
    const content = readFileSync(join(root, rel), "utf8");
    if (rel === "package.json") {
      const m = content.match(/"version":\s*"(\d+\.\d+\.\d+)"/);
      out[rel] = m ? m[1] : null;
    } else if (rel === "src/config.ts") {
      const m = content.match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/);
      out[rel] = m ? m[1] : null;
    } else if (rel.endsWith("SKILL.md")) {
      const m = content.match(/^version:\s*(\d+\.\d+\.\d+)/m);
      out[rel] = m ? m[1] : null;
    } else if (rel === "src/cli/install-skill.ts") {
      const m = content.match(
        /Cursor \+ Cline auto-install not supported in v(\d+\.\d+\.\d+)/,
      );
      out[rel] = m ? m[1] : null;
    }
  }
  return out;
}

describe("scripts/bump-version.mjs · R20 5-surface lockstep", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = buildFixture("0.9.3");
  });

  afterEach(() => {
    fx.cleanup();
  });

  it("script file exists at scripts/bump-version.mjs", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("invalid version arg exits non-zero with clear message", () => {
    const res = runBump(fx.root, ["nope"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Invalid version/i);
  });

  it("missing target arg exits non-zero", () => {
    const res = runBump(fx.root, []);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Missing target version|Usage/);
  });

  it("idempotent — running with current version is a no-op + exit 0", () => {
    const res = runBump(fx.root, ["0.9.3"]);
    expect(res.status).toBe(0);
    const after = readSurfaceVersions(fx.root);
    for (const rel of SURFACES) {
      expect(after[rel], `${rel} stayed at 0.9.3`).toBe("0.9.3");
    }
    // Status column should show "noop" for every row.
    expect((res.stdout.match(/noop/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("bumps 0.9.3 → 1.0.0 across all 5 surfaces + verifies post-write", () => {
    const res = runBump(fx.root, ["1.0.0"]);
    expect(res.status, res.stderr).toBe(0);
    const after = readSurfaceVersions(fx.root);
    for (const rel of SURFACES) {
      expect(after[rel], `${rel} should be 1.0.0`).toBe("1.0.0");
    }
    expect(res.stdout).toMatch(/Bumped 5 of 5/);
  });

  it("refuses to bump when a surface has uncommitted edits (no --force)", () => {
    // Dirty package.json.
    const pkgPath = join(fx.root, "package.json");
    const pkg = readFileSync(pkgPath, "utf8");
    writeFileSync(pkgPath, pkg.replace(/magpie-mcp/, "magpie-mcp-dirty"), "utf8");

    const res = runBump(fx.root, ["1.0.0"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Refusing to bump/i);
    expect(res.stderr).toMatch(/package\.json/);

    // None of the surfaces should have changed version.
    const after = readSurfaceVersions(fx.root);
    for (const rel of SURFACES) {
      expect(after[rel], `${rel} unchanged`).toBe("0.9.3");
    }
  });

  it("--force overrides the dirty guard", () => {
    const pkgPath = join(fx.root, "package.json");
    const pkg = readFileSync(pkgPath, "utf8");
    writeFileSync(pkgPath, pkg.replace(/magpie-mcp/, "magpie-mcp-dirty"), "utf8");

    const res = runBump(fx.root, ["1.0.0", "--force"]);
    expect(res.status, res.stderr).toBe(0);
    const after = readSurfaceVersions(fx.root);
    for (const rel of SURFACES) {
      expect(after[rel]).toBe("1.0.0");
    }
  });

  it("--dry-run prints plan without writing", () => {
    const res = runBump(fx.root, ["1.0.0", "--dry-run"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/dry-run/);
    expect(res.stdout).toMatch(/planned/);
    const after = readSurfaceVersions(fx.root);
    for (const rel of SURFACES) {
      expect(after[rel], `${rel} untouched`).toBe("0.9.3");
    }
  });

  it("real repo's 5 surfaces are all currently in sync (sanity check)", () => {
    // Don't mutate; just read each real surface and confirm they agree.
    // Allows us to catch drift before a bump attempt.
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    const configSrc = readFileSync(resolve(REPO_ROOT, "src/config.ts"), "utf8");
    const masterMd = readFileSync(
      resolve(REPO_ROOT, "skill/magpie-master/SKILL.md"),
      "utf8",
    );
    const stewardMd = readFileSync(
      resolve(REPO_ROOT, "skill/magpie-steward/SKILL.md"),
      "utf8",
    );
    const installSrc = readFileSync(
      resolve(REPO_ROOT, "src/cli/install-skill.ts"),
      "utf8",
    );

    const configV = configSrc.match(/VERSION\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1];
    const masterV = masterMd.match(/^version:\s*(\d+\.\d+\.\d+)/m)?.[1];
    const stewardV = stewardMd.match(/^version:\s*(\d+\.\d+\.\d+)/m)?.[1];
    const installV = installSrc.match(
      /Cursor \+ Cline auto-install not supported in v(\d+\.\d+\.\d+)/,
    )?.[1];

    expect(configV).toBe(pkg.version);
    expect(masterV).toBe(pkg.version);
    expect(stewardV).toBe(pkg.version);
    expect(installV).toBe(pkg.version);
  });
});

