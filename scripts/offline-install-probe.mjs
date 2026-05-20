#!/usr/bin/env node
// v0.9.2 Phase E/E3 — Offline install probe.
// Verifies the magpie-mcp tarball installs under `npm install --offline` once
// the npm cache has been warmed. Cold offline install (no cache) is out of
// scope and documented in audit-04-install.md § E3 — npm itself surfaces the
// ENOTFOUND family of errors, which is sufficient.
//
// Usage: node scripts/offline-install-probe.mjs <tarball-path>
//
// Exits 0 on success (offline install survived) or 1 with a captured error.

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function fail(message, extra = {}) {
  process.stderr.write(`offline-install-probe: ${message}\n`);
  for (const [k, v] of Object.entries(extra)) {
    process.stderr.write(`  ${k}: ${v}\n`);
  }
  process.exit(1);
}

const tarballArg = process.argv[2];
if (!tarballArg) fail('missing tarball path argument');
const tarball = resolve(tarballArg);
if (!existsSync(tarball)) fail(`tarball not found: ${tarball}`);

const probeDir = mkdtempSync(join(tmpdir(), 'magpie-offline-probe-'));
writeFileSync(join(probeDir, 'package.json'), JSON.stringify({ name: 'offline-probe', version: '0.0.0', private: true }, null, 2));

process.stdout.write(`probe dir: ${probeDir}\n`);
process.stdout.write(`tarball:   ${tarball}\n`);

// Step 1 — warm the npm cache by running a non-offline install in a throwaway
// dir. Captures the artifact + transitive deps into the local npm cache.
const warmDir = mkdtempSync(join(tmpdir(), 'magpie-offline-warm-'));
writeFileSync(join(warmDir, 'package.json'), JSON.stringify({ name: 'offline-warm', version: '0.0.0', private: true }, null, 2));
process.stdout.write(`warm dir:  ${warmDir}\n`);

const warmResult = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', tarball], {
  cwd: warmDir,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (warmResult.status !== 0) {
  fail('cache-warm install failed (this is a hard fault — offline probe cannot proceed)', {
    exit: warmResult.status,
    stderr_tail: (warmResult.stderr ?? '').split(/\r?\n/).slice(-10).join(' | '),
  });
}
process.stdout.write('cache-warm install OK\n');

// Step 2 — replay the install in a clean dir with --offline. If npm cache is
// truly warm, this should succeed; if any dep slipped (e.g. a prebuild fetch),
// surface the error verbatim.
const offlineResult = spawnSync('npm', ['install', '--offline', '--omit=dev', '--no-audit', '--no-fund', tarball], {
  cwd: probeDir,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

process.stdout.write('--- offline install stdout ---\n');
process.stdout.write(offlineResult.stdout ?? '');
process.stdout.write('--- offline install stderr ---\n');
process.stdout.write(offlineResult.stderr ?? '');
process.stdout.write('--- end ---\n');

if (offlineResult.status !== 0) {
  fail('offline install failed after warm cache', {
    exit: offlineResult.status,
    stderr_tail: (offlineResult.stderr ?? '').split(/\r?\n/).slice(-15).join(' | '),
  });
}

// Step 3 — sanity-boot the installed binary (no network needed).
const binCheck = spawnSync(
  process.platform === 'win32' ? 'node_modules\\.bin\\magpie-mcp.cmd' : 'node_modules/.bin/magpie-mcp',
  ['--version'],
  {
    cwd: probeDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
if (binCheck.status !== 0) {
  fail('offline-installed binary did not run --version cleanly', {
    exit: binCheck.status,
    stderr_tail: (binCheck.stderr ?? '').split(/\r?\n/).slice(-10).join(' | '),
  });
}
process.stdout.write(`installed magpie-mcp version: ${(binCheck.stdout ?? '').trim()}\n`);
process.stdout.write('offline install probe: PASS\n');
