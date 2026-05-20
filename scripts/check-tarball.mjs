// v0.9.2 Phase B / S1 - Tarball allowlist gate.
// Asserts the published artifact contains only intended files.
// Run before npm publish; fails CI on any disallowed path.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DISALLOWED_PATTERNS = [
  { re: /\.map$/i,                            reason: 'source map' },
  { re: /\.test\.[mc]?[jt]sx?$/i,             reason: 'test file' },
  { re: /\.test-helper\.[mc]?[jt]sx?$/i,      reason: 'test helper' },
  { re: /(^|\/)__tests__\//,                  reason: '__tests__ dir' },
  { re: /(^|\/)tests?\//i,                    reason: 'tests dir' },
  { re: /(^|\/)\.tmp[-_a-z0-9]*\//i,          reason: 'scratch / .tmp- dir' },
  { re: /(^|\/)\.env(\.|$)/i,                 reason: '.env file' },
  { re: /(^|\/)fixture[s]?\//i,               reason: 'fixtures dir' },
  { re: /(^|\/)\.git(\/|$|ignore$|attributes$)/i, reason: '.git artifact' },
  { re: /(^|\/)scratch\//i,                   reason: 'scratch dir' },
  { re: /(^|\/)\.vscode\//i,                  reason: 'editor config' },
  { re: /(^|\/)\.idea\//i,                    reason: 'editor config' },
  { re: /(^|\/)coverage\//i,                  reason: 'coverage report' },
  { re: /(^|\/)\.DS_Store$/i,                 reason: 'macOS metadata' },
  { re: /(^|\/)Thumbs\.db$/i,                 reason: 'Windows metadata' },
  { re: /\.log$/i,                            reason: 'log file' },
];

export function packDryRun() {
  const json = execSync('npm pack --dry-run --json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack --dry-run --json returned empty array');
  }
  return parsed[0];
}

export function check(pack) {
  const offenders = [];
  for (const file of pack.files) {
    for (const { re, reason } of DISALLOWED_PATTERNS) {
      if (re.test(file.path)) {
        offenders.push({ path: file.path, size: file.size, reason });
        break;
      }
    }
  }
  return offenders;
}

function main() {
  const argMode = process.argv[2] ?? 'check';
  const pack = packDryRun();
  const offenders = check(pack);

  const summary = {
    name: pack.name,
    version: pack.version,
    fileCount: pack.files.length,
    unpackedSize: pack.unpackedSize,
    tarballSize: pack.size,
    offenders,
  };

  if (argMode === '--json') {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exit(offenders.length === 0 ? 0 : 1);
  }

  console.log(`magpie-mcp tarball check · ${pack.name}@${pack.version}`);
  console.log(`  files: ${pack.files.length}`);
  console.log(`  unpacked: ${(pack.unpackedSize / 1024).toFixed(0)} KB`);
  console.log(`  tarball:  ${(pack.size / 1024).toFixed(0)} KB`);

  if (offenders.length === 0) {
    console.log('  status:   OK · no disallowed paths');
    process.exit(0);
  }

  console.error(`  status:   FAIL · ${offenders.length} disallowed path(s)`);
  for (const o of offenders.slice(0, 50)) {
    console.error(`    ! ${o.path}  (${o.reason}, ${o.size} bytes)`);
  }
  if (offenders.length > 50) {
    console.error(`    ... and ${offenders.length - 50} more`);
  }
  process.exit(1);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
