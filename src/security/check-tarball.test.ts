import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs script with pure exports; no .d.ts.
import { DISALLOWED_PATTERNS, check } from '../../scripts/check-tarball.mjs';

type FakeFile = { path: string; size: number };
type FakePack = { name: string; version: string; files: FakeFile[] };

function pack(files: FakeFile[]): FakePack {
  return { name: 'magpie-mcp', version: '0.9.2-test', files };
}

describe('S1 · tarball allowlist gate', () => {
  it('passes when all files are intended (dist · skill · README · LICENSE)', () => {
    const offenders = check(pack([
      { path: 'dist/index.js',                 size: 1000 },
      { path: 'dist/store/db.js',              size: 500 },
      { path: 'skill/magpie-master/SKILL.md',  size: 10000 },
      { path: 'README.md',                     size: 14000 },
      { path: 'LICENSE',                       size: 1000 },
      { path: 'package.json',                  size: 2000 },
    ]));
    expect(offenders).toEqual([]);
  });

  it('rejects source maps (.map) - primary v0.9.2 finding', () => {
    const offenders = check(pack([
      { path: 'dist/index.js',     size: 1000 },
      { path: 'dist/index.js.map', size: 1500 },
    ]));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.path).toBe('dist/index.js.map');
    expect(offenders[0]?.reason).toBe('source map');
  });

  it('rejects test files in dist', () => {
    const offenders = check(pack([
      { path: 'dist/store/db.test.js',     size: 200 },
      { path: 'dist/foo.test.mjs',         size: 200 },
      { path: 'dist/bar.test-helper.js',   size: 200 },
    ]));
    const reasons = offenders.map((o: { reason: string }) => o.reason);
    expect(reasons).toContain('test file');
    expect(reasons).toContain('test helper');
    expect(offenders.length).toBe(3);
  });

  it('rejects scratch / .tmp dirs that escape gitignore', () => {
    const offenders = check(pack([
      { path: '.tmp-smoke-home/db.sqlite',     size: 1000 },
      { path: '.tmp-research-summary/foo.html', size: 1000 },
      { path: 'scratch/notes.md',              size: 500 },
    ]));
    expect(offenders).toHaveLength(3);
    expect(offenders.map((o: { reason: string }) => o.reason)).toEqual([
      'scratch / .tmp- dir',
      'scratch / .tmp- dir',
      'scratch dir',
    ]);
  });

  it('rejects .env, .git artifacts, editor configs, OS junk, logs', () => {
    const offenders = check(pack([
      { path: '.env',                size: 100 },
      { path: '.env.production',     size: 100 },
      { path: '.gitignore',          size: 100 },
      { path: '.vscode/settings.json', size: 100 },
      { path: '.idea/workspace.xml', size: 100 },
      { path: 'coverage/index.html', size: 100 },
      { path: '.DS_Store',           size: 6000 },
      { path: 'Thumbs.db',           size: 7000 },
      { path: 'install.log',         size: 100 },
    ]));
    expect(offenders.length).toBe(9);
  });

  it('rejects fixtures dirs (test data leaks)', () => {
    const offenders = check(pack([
      { path: 'src/foo/fixtures/bad.html', size: 100 },
      { path: 'dist/fixture/oops.json',    size: 100 },
    ]));
    expect(offenders).toHaveLength(2);
    expect(offenders[0]?.reason).toBe('fixtures dir');
  });

  it('DISALLOWED_PATTERNS list is non-empty and well-formed', () => {
    expect(DISALLOWED_PATTERNS.length).toBeGreaterThanOrEqual(10);
    for (const p of DISALLOWED_PATTERNS) {
      expect(p.re).toBeInstanceOf(RegExp);
      expect(typeof p.reason).toBe('string');
      expect(p.reason.length).toBeGreaterThan(0);
    }
  });
});
