import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error - .mjs script with pure exports; no .d.ts.
import { ALLOWED_INSTALL_SCRIPTS, audit, scanForInstallScripts } from '../../scripts/audit-postinstall.mjs';

describe('S2 - postinstall audit - prod tree', () => {
  it('allowlist contains only better-sqlite3 (the one legitimate native compile)', () => {
    expect(ALLOWED_INSTALL_SCRIPTS instanceof Set).toBe(true);
    expect(Array.from(ALLOWED_INSTALL_SCRIPTS)).toEqual(['better-sqlite3']);
  });

  it('Magpie own package.json declares only the v0.9.2 preinstall friendly-fallback gate', () => {
    // v0.9.2 Phase E/E2 - `preinstall` runs the platform/toolchain check before
    // npm install resolves better-sqlite3. No `install` or `postinstall` hook -
    // better-sqlite3 owns its own native compile hook one level down.
    const pkgPath = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    expect(scripts.preinstall).toBe('node scripts/preinstall-check.mjs');
    expect(scripts.install).toBeUndefined();
    expect(scripts.postinstall).toBeUndefined();
  });

  it('production tree contains exactly the allowed install-script set (better-sqlite3 only)', () => {
    const result = audit();
    expect(result.scannedCount).toBeGreaterThan(50);
    const hitNames = result.hits.map((h: { name: string }) => h.name).sort();
    expect(hitNames).toEqual(['better-sqlite3']);
    expect(result.offenders).toEqual([]);
  });

  it('better-sqlite3 install script is the documented prebuild-install fallback', () => {
    const result = audit();
    const bsq = result.hits.find((h: { name: string }) => h.name === 'better-sqlite3');
    expect(bsq).toBeDefined();
    const installScript = bsq.scripts.find((s: { key: string }) => s.key === 'install');
    expect(installScript).toBeDefined();
    expect(installScript.value).toMatch(/prebuild-install/);
  });

  it('scanForInstallScripts returns empty when given an empty path list', () => {
    expect(scanForInstallScripts([])).toEqual([]);
  });

  it('scanForInstallScripts gracefully handles non-existent paths', () => {
    expect(scanForInstallScripts(['/nonexistent/path/that/does/not/exist'])).toEqual([]);
  });
});
