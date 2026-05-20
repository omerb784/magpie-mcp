import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PREINSTALL = resolve(process.cwd(), 'scripts/preinstall-check.mjs');

function runPreinstall(env: Record<string, string>) {
  return spawnSync(process.execPath, [PREINSTALL], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

describe('E2 · preinstall-check.mjs · friendly-fallback gate', () => {
  it('script exists on disk', () => {
    expect(existsSync(PREINSTALL)).toBe(true);
  });

  it('exits 0 silently on a supported platform-arch (win32-x64)', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'win32',
      MAGPIE_PREINSTALL_TEST_ARCH: 'x64',
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('');
    expect((result.stderr ?? '').trim()).toBe('');
  });

  it('exits 0 silently on supported darwin-arm64', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'darwin',
      MAGPIE_PREINSTALL_TEST_ARCH: 'arm64',
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('');
  });

  it('exits 1 with friendly Windows message when arch unsupported + toolchain absent', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'win32',
      MAGPIE_PREINSTALL_TEST_ARCH: 'ia32',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'absent',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Visual Studio Build Tools/);
    expect(result.stderr).toMatch(/win32-ia32/);
    expect(result.stderr).toMatch(/visualstudio\.microsoft\.com/);
  });

  it('exits 1 with friendly macOS message on unsupported darwin arch + toolchain absent', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'darwin',
      MAGPIE_PREINSTALL_TEST_ARCH: 'ia32',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'absent',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/xcode-select --install/);
  });

  it('exits 1 with friendly Linux message on unsupported linux arch + toolchain absent', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'linux',
      MAGPIE_PREINSTALL_TEST_ARCH: 'arm',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'absent',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/build-essential python3/);
  });

  it('exits 1 with generic message on truly exotic platform + toolchain absent', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'freebsd',
      MAGPIE_PREINSTALL_TEST_ARCH: 'x64',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'absent',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/install a C\/C\+\+ toolchain/);
    expect(result.stderr).toMatch(/freebsd-x64/);
  });

  it('exits 0 silently when toolchain is present even on unsupported arch', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'linux',
      MAGPIE_PREINSTALL_TEST_ARCH: 'arm',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'present',
    });
    expect(result.status).toBe(0);
    expect((result.stderr ?? '').trim()).toBe('');
  });

  it('honours MAGPIE_SKIP_PREINSTALL_CHECK=1 escape hatch', () => {
    const result = runPreinstall({
      MAGPIE_PREINSTALL_TEST_PLATFORM: 'freebsd',
      MAGPIE_PREINSTALL_TEST_ARCH: 'x64',
      MAGPIE_PREINSTALL_TEST_TOOLCHAIN: 'absent',
      MAGPIE_SKIP_PREINSTALL_CHECK: '1',
    });
    expect(result.status).toBe(0);
    expect((result.stderr ?? '').trim()).toBe('');
  });
});
