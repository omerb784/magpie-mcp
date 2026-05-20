// v0.9.2 Phase B / S5 - SBOM generator.
// Emits a CycloneDX 1.5 JSON SBOM at `sbom.json` covering the production
// dependency tree (devDependencies omitted, matching what npm publish ships).
// Run pre-publish in the publish workflow; attached as a release artifact.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SPEC_VERSION = '1.5';

function purlFor(name, version) {
  // Scoped packages: pkg:npm/%40scope/name@version per PURL spec.
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return `pkg:npm/${encodeURIComponent(scope)}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function walkDeps(node, out, seen) {
  const deps = node.dependencies ?? {};
  for (const [name, child] of Object.entries(deps)) {
    if (!child || typeof child !== 'object') continue;
    const version = child.version;
    if (!version) continue;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: 'library',
      'bom-ref': purlFor(name, version),
      name,
      version,
      purl: purlFor(name, version),
    });
    walkDeps(child, out, seen);
  }
}

export function buildSbom(cwd = process.cwd()) {
  const pkgPath = join(cwd, 'package.json');
  const rootPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  const lsJson = execSync('npm ls --omit=dev --all --json', {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const tree = JSON.parse(lsJson);

  const components = [];
  walkDeps(tree, components, new Set());

  return {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'magpie-mcp',
          name: 'generate-sbom.mjs',
          version: rootPkg.version,
        },
      ],
      component: {
        type: 'application',
        'bom-ref': purlFor(rootPkg.name, rootPkg.version),
        name: rootPkg.name,
        version: rootPkg.version,
        purl: purlFor(rootPkg.name, rootPkg.version),
        licenses: rootPkg.license ? [{ license: { id: rootPkg.license } }] : undefined,
      },
    },
    components,
  };
}

function main() {
  const argMode = process.argv[2] ?? 'write';
  const sbom = buildSbom();
  const json = JSON.stringify(sbom, null, 2);

  if (argMode === '--stdout') {
    process.stdout.write(json + '\n');
    return;
  }

  const outPath = join(process.cwd(), 'sbom.json');
  writeFileSync(outPath, json + '\n', 'utf8');
  console.log(`magpie-mcp SBOM · CycloneDX ${SPEC_VERSION}`);
  console.log(`  components: ${sbom.components.length}`);
  console.log(`  output:     ${outPath}`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
