import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs script with pure exports; no .d.ts.
import { buildSbom } from '../../scripts/generate-sbom.mjs';

interface Component {
  type: string;
  'bom-ref': string;
  name: string;
  version: string;
  purl: string;
}

interface Sbom {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ vendor: string; name: string; version: string }>;
    component: Component & { licenses?: Array<{ license: { id: string } }> };
  };
  components: Component[];
}

describe('S5 · SBOM · CycloneDX 1.5', () => {
  const sbom = buildSbom() as Sbom;

  it('top-level shape matches CycloneDX 1.5 spec', () => {
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.version).toBe(1);
    expect(sbom.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('metadata.timestamp is a valid ISO-8601 string', () => {
    expect(() => new Date(sbom.metadata.timestamp).toISOString()).not.toThrow();
    expect(sbom.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('metadata.component identifies magpie-mcp', () => {
    expect(sbom.metadata.component.type).toBe('application');
    expect(sbom.metadata.component.name).toBe('magpie-mcp');
    expect(sbom.metadata.component.purl).toMatch(/^pkg:npm\/magpie-mcp@/);
    expect(sbom.metadata.component.licenses?.[0]?.license?.id).toBe('MIT');
  });

  it('metadata.tools names the generator', () => {
    const tool = sbom.metadata.tools[0];
    expect(tool.vendor).toBe('magpie-mcp');
    expect(tool.name).toBe('generate-sbom.mjs');
  });

  it('components array is non-empty and covers the prod tree', () => {
    expect(Array.isArray(sbom.components)).toBe(true);
    expect(sbom.components.length).toBeGreaterThan(50);
  });

  it('every component has type, name, version, purl, bom-ref', () => {
    for (const c of sbom.components) {
      expect(c.type).toBe('library');
      expect(c.name).toBeTypeOf('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.version).toMatch(/^\d/);
      expect(c.purl).toMatch(/^pkg:npm\//);
      expect(c['bom-ref']).toBe(c.purl);
    }
  });

  it('scoped package purls encode the @ scope as %40', () => {
    const scoped = sbom.components.filter((c) => c.name.startsWith('@'));
    expect(scoped.length).toBeGreaterThan(0);
    for (const c of scoped) {
      expect(c.purl).toMatch(/^pkg:npm\/%40[^/]+\/[^@]+@/);
    }
  });

  it('purl reflects the component name and version exactly', () => {
    const sample = sbom.components.find((c) => c.name === 'better-sqlite3');
    expect(sample).toBeDefined();
    expect(sample!.purl).toBe(`pkg:npm/better-sqlite3@${sample!.version}`);
  });

  it('no duplicate name@version pairs', () => {
    const keys = sbom.components.map((c) => `${c.name}@${c.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('production-only - devDependencies excluded', () => {
    const devOnly = ['vitest', 'vite', 'typescript', 'tsx', 'concurrently'];
    for (const dev of devOnly) {
      const hit = sbom.components.find((c) => c.name === dev);
      expect(hit, `${dev} should not appear in prod SBOM`).toBeUndefined();
    }
  });

  it('known prod deps appear in the SBOM', () => {
    const expected = ['hono', 'better-sqlite3', 'zod', 'puppeteer-core', 'mermaid'];
    for (const name of expected) {
      const hit = sbom.components.find((c) => c.name === name);
      expect(hit, `${name} should appear in prod SBOM`).toBeDefined();
    }
  });
});
