// One-shot resize for site/assets/brand/. Reads masters from .tmp-brand-assets/
// and copies bg-stripped raster variants from the worktree where available.
// Targets ~1024-1280px wide PNGs; quality stays high but page weight drops
// from ~5MB per hero to ~300-500KB.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'assets', 'brand');
const MASTER = path.join(ROOT, '.tmp-brand-assets');
const RASTER = path.join(
  ROOT,
  '.claude', 'worktrees', 'agent-a42be5dcb3f0802be',
  'assets', 'brand', 'raster'
);

// [src, dst, width] — dst is the path inside site/assets/brand/
const jobs = [
  // heroes: resize masters down from 5MB to ~1280px
  ['p01-hero.png', 'p01-hero.png', 1280, MASTER],
  ['p05-og-v2.png', 'p05-og-v2.png', 1200, MASTER],
  // detail shots: 5MB masters → 1024px
  ['p03-nest.png', 'p03-nest.png', 1024, MASTER],
  ['p04-master.png', 'p04-master.png', 1024, MASTER],
  ['p06-paper-texture.png', 'p06-paper-texture.png', 1024, MASTER],
  // alt poses + branch-perched mark: pre-stripped raster 1024 → 800
  ['p02-pose-01-takeoff.png', 'p02-pose-01-takeoff.png', 800, RASTER],
  ['p02-pose-03-descent.png', 'p02-pose-03-descent.png', 800, RASTER],
  ['m01-mark-square.png', 'm01-mark-square.png', 512, RASTER],
];

await fs.mkdir(OUT, { recursive: true });

for (const [srcName, dstName, width, srcDir] of jobs) {
  const src = path.join(srcDir, srcName);
  const dst = path.join(OUT, dstName);
  try {
    const buf = await sharp(src)
      .resize({ width, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    await fs.writeFile(dst, buf);
    const stat = await fs.stat(dst);
    console.log(`✓ ${dstName.padEnd(34)} ${(stat.size / 1024).toFixed(0).padStart(4)} KB`);
  } catch (err) {
    console.log(`✗ ${dstName}  ${err.message}`);
  }
}
