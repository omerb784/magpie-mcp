// v0.9.2 Phase B / S2 - Postinstall audit.
// Asserts the production dependency tree contains only allowlisted install scripts.
// Run before npm publish; fails CI if a new install-script package enters the tree.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_INSTALL_SCRIPTS = new Set([
  'better-sqlite3',
]);

const INSTALL_LIFECYCLE_KEYS = ['preinstall', 'install', 'postinstall'];

export function enumerateProdPackages(cwd = process.cwd()) {
  const out = execSync('npm ls --omit=dev --all --parseable', {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.trim().split(/\r?\n/).filter(Boolean);
}

export function scanForInstallScripts(paths) {
  const hits = [];
  for (const p of paths) {
    const pj = join(p, 'package.json');
    if (!existsSync(pj)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(pj, 'utf8'));
    } catch {
      continue;
    }
    const scripts = parsed.scripts ?? {};
    const found = [];
    for (const key of INSTALL_LIFECYCLE_KEYS) {
      if (scripts[key]) found.push({ key, value: scripts[key] });
    }
    if (found.length > 0) {
      hits.push({
        name: parsed.name,
        version: parsed.version,
        scripts: found,
        path: p,
      });
    }
  }
  return hits;
}

export function audit(cwd = process.cwd()) {
  const paths = enumerateProdPackages(cwd).filter((p) => p !== cwd);
  const hits = scanForInstallScripts(paths);
  const offenders = hits.filter((h) => !ALLOWED_INSTALL_SCRIPTS.has(h.name));
  return { scannedCount: paths.length, hits, offenders };
}

function main() {
  const argMode = process.argv[2] ?? 'check';
  const result = audit();

  if (argMode === '--json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.offenders.length === 0 ? 0 : 1);
  }

  console.log('magpie-mcp postinstall audit · prod tree');
  console.log(`  scanned:   ${result.scannedCount} package paths`);
  console.log(`  hits:      ${result.hits.length} package(s) with install scripts`);
  for (const h of result.hits) {
    const tag = ALLOWED_INSTALL_SCRIPTS.has(h.name) ? 'ALLOWED' : 'OFFENDER';
    console.log(`    [${tag}] ${h.name}@${h.version}`);
    for (const s of h.scripts) {
      console.log(`            ${s.key} = ${s.value}`);
    }
  }

  if (result.offenders.length === 0) {
    console.log('  status:    OK · only allowlisted install scripts present');
    process.exit(0);
  }

  console.error(`  status:    FAIL · ${result.offenders.length} unexpected install-script package(s)`);
  for (const o of result.offenders) {
    console.error(`    ! ${o.name}@${o.version}`);
  }
  console.error('  next:      review the new package; if legitimate add to ALLOWED_INSTALL_SCRIPTS in scripts/audit-postinstall.mjs and document in SECURITY.md');
  process.exit(1);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
