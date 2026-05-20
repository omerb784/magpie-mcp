import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROBE = resolve(process.cwd(), 'scripts/offline-install-probe.mjs');

describe('E3 · offline install probe · script shape', () => {
  it('probe script exists on disk', () => {
    expect(existsSync(PROBE)).toBe(true);
  });

  it('exits 1 with friendly message when invoked without a tarball argument', () => {
    const result = spawnSync(process.execPath, [PROBE], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/missing tarball path argument/);
  });

  it('exits 1 with friendly message when the tarball path does not exist', () => {
    const result = spawnSync(process.execPath, [PROBE, '/nonexistent/path/magpie.tgz'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tarball not found/);
  });
});
