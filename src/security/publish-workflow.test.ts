import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/publish.yml');

describe('S3 · publish workflow scaffold', () => {
  let yml: string;

  beforeAll(() => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    yml = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('triggers ONLY on v1.* tags — never on v0.x', () => {
    const tagsSection = yml.match(/tags:\s*\n\s*-\s*'?v1\.\*'?/);
    expect(tagsSection).not.toBeNull();
    expect(yml).not.toMatch(/tags:\s*\n\s*-\s*'?v0\./);
    expect(yml).not.toMatch(/branches:\s*\n\s*-\s*main/);
  });

  it('declares workflow-scope contents:read (least-privilege baseline)', () => {
    expect(yml).toMatch(/^permissions:\s*\n\s*contents:\s*read\s*$/m);
  });

  it('grants id-token:write at JOB scope (required by --provenance OIDC)', () => {
    const jobBlock = yml.match(/publish:[\s\S]+?steps:/);
    expect(jobBlock).not.toBeNull();
    expect(jobBlock?.[0]).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/);
  });

  it('runs check:tarball gate before publish', () => {
    const tarballIdx = yml.indexOf('npm run check:tarball');
    const publishIdx = yml.indexOf('run: npm publish --provenance --access public');
    expect(tarballIdx).toBeGreaterThan(0);
    expect(publishIdx).toBeGreaterThan(0);
    expect(tarballIdx).toBeLessThan(publishIdx);
  });

  it('runs audit:postinstall before publish', () => {
    const auditIdx = yml.indexOf('npm run audit:postinstall');
    const publishIdx = yml.indexOf('run: npm publish --provenance --access public');
    expect(auditIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeLessThan(publishIdx);
  });

  it('publishes with --provenance flag (OIDC attestation)', () => {
    expect(yml).toMatch(/npm publish --provenance --access public/);
  });

  it('verifies tag matches package.json version before publishing', () => {
    expect(yml).toMatch(/Verify tag matches package\.json version/);
    expect(yml).toMatch(/Tag \$TAG does not match package\.json version/);
  });

  it('uses npm ci (clean install) — never npm install', () => {
    expect(yml).toMatch(/npm ci/);
    expect(yml).not.toMatch(/\bnpm install\b/);
  });

  it('runs full test:all (unit + e2e) before publish', () => {
    expect(yml).toMatch(/npm run test:all/);
  });

  it('targets Node 20 (matches engines.node ≥20)', () => {
    expect(yml).toMatch(/node-version:\s*20/);
  });
});
