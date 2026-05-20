#!/usr/bin/env node
// v0.9.2 Phase E/E2 — Preinstall friendly-fallback check.
// Runs before `npm install magpie-mcp` resolves better-sqlite3. If the host
// platform lacks both a published better-sqlite3 prebuild AND a native compile
// toolchain, exit 1 with a platform-specific actionable message instead of
// letting node-gyp crash deep inside the install transcript.
//
// Owner decision i (v0.9.2 Phase E open, 2026-05-14): ship prebuilds for the 5
// main platforms + this preinstall fallback so users on unsupported arches get
// a clear next step instead of a wall of node-gyp output.
//
// Supported platforms (better-sqlite3 ships prebuilt binaries):
//   - win32-x64, win32-arm64
//   - darwin-x64, darwin-arm64
//   - linux-x64
//
// Anything else → check for a toolchain → friendly message if missing.
//
// Failure modes are intentionally noisy on stderr; success is silent so the
// install transcript stays clean for the happy path.

import { execSync } from 'node:child_process';

const SUPPORTED_PLATFORM_ARCH = new Set([
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
]);

// Test hooks — set via env to exercise edge paths in CI / vitest without
// actually running on an unsupported host.
function effectivePlatform() {
  return process.env.MAGPIE_PREINSTALL_TEST_PLATFORM ?? process.platform;
}
function effectiveArch() {
  return process.env.MAGPIE_PREINSTALL_TEST_ARCH ?? process.arch;
}

function checkCommand(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function detectToolchain(platform) {
  if (process.env.MAGPIE_PREINSTALL_TEST_TOOLCHAIN === 'absent') return false;
  if (process.env.MAGPIE_PREINSTALL_TEST_TOOLCHAIN === 'present') return true;

  switch (platform) {
    case 'win32':
      // Either MSBuild on PATH or a recent VS install in the standard registry
      // path. The cheap PATH check is enough for the friendly-message gate;
      // a real compile failure later still surfaces node-gyp's own error.
      return checkCommand('where msbuild') || checkCommand('where cl');
    case 'darwin':
      // xcode-select -p exits 0 only when a developer dir is configured.
      return checkCommand('xcode-select -p');
    case 'linux':
      return checkCommand('command -v gcc') && checkCommand('command -v python3');
    default:
      return false;
  }
}

function friendlyMessage(platform) {
  const lines = [
    '',
    'magpie-mcp · preinstall check',
    `  Platform: ${platform}-${effectiveArch()}`,
    '  Issue:    no better-sqlite3 prebuild for this platform AND no native compile toolchain detected.',
    '',
    '  Magpie needs better-sqlite3, which ships prebuilt binaries for:',
    '    win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64',
    '',
    '  For other arches Magpie compiles better-sqlite3 from source.',
    '  To compile from source, install the toolchain for your OS:',
    '',
  ];
  switch (platform) {
    case 'win32':
      lines.push('    Windows: install Visual Studio Build Tools');
      lines.push('             https://visualstudio.microsoft.com/visual-cpp-build-tools/');
      lines.push('             (select the "Desktop development with C++" workload)');
      break;
    case 'darwin':
      lines.push('    macOS:   run  xcode-select --install');
      break;
    case 'linux':
      lines.push('    Linux:   install gcc and python3 (apt: sudo apt install build-essential python3)');
      break;
    default:
      lines.push(`    ${platform}: install a C/C++ toolchain and python3, then re-run npm install.`);
  }
  lines.push('');
  lines.push('  After installing the toolchain, re-run:  npm install magpie-mcp');
  lines.push('');
  return lines.join('\n');
}

function main() {
  // Opt-out for users who want to skip the check entirely (e.g. a CI that
  // already validated toolchain availability out-of-band).
  if (process.env.MAGPIE_SKIP_PREINSTALL_CHECK === '1') {
    return 0;
  }

  const platform = effectivePlatform();
  const arch = effectiveArch();
  const key = `${platform}-${arch}`;

  if (SUPPORTED_PLATFORM_ARCH.has(key)) {
    return 0;
  }

  if (detectToolchain(platform)) {
    return 0;
  }

  process.stderr.write(friendlyMessage(platform));
  return 1;
}

process.exit(main());
