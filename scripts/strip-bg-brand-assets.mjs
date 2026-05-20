// Chroma-key the cream paper background out of the painterly brand rasters
// (P01 hero · P03 nest · P04 master). P05 OG card and P06 texture keep their
// backgrounds — P05 ships as a social card (transparent renders black on dark
// themes), P06 IS the texture. The M01-04 + P02-01..04 set already shipped
// bg-stripped via the brand-kit handover and lives in the worktree raster/ dir.
//
// Approach: sample bg color from the 4 corners (averaged), then for each pixel
// alpha = ramp(distance_to_bg, lo, hi). Below `lo` = fully transparent (clean
// bg), above `hi` = fully opaque (subject). In between = soft anti-aliased
// edge that preserves feather/edge detail.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'site', 'assets', 'brand');
const MASTER = path.join(ROOT, '.tmp-brand-assets');

// [srcName, dstName, targetWidth, loThreshold, hiThreshold]
// Lower lo/hi = more aggressive bg removal but more risk of clipping subject
// pixels close to bg color (e.g. white bird belly on cream bg).
const jobs = [
  // P01 painterly has heavy bg texture/grain — needs aggressive lo/hi.
  // White bird belly distance-to-bg ~70-80, so hi must stay under that.
  ['p01-hero.png',    'p01-hero.png',    1280, 38, 70],
  ['p03-nest.png',    'p03-nest.png',    1024, 22, 60],
  ['p04-master.png',  'p04-master.png',  1024, 22, 60],
  // P05 OG card — bg-stripped variant for on-page hero use.
  // Has darker textured bg + faint handwritten margin annotations.
  // Aggressive lo to clear the texture; hi pushed so bird body stays opaque.
  // The faint annotations are decorative — losing them is OK.
  // KEEP the original `p05-og-v2.png` with bg for og:image meta.
  ['p05-og-v2.png',   'p05-hero-stripped.png', 1280, 55, 95],
];

await fs.mkdir(OUT, { recursive: true });

for (const [srcName, dstName, width, loThr, hiThr] of jobs) {
  const src = path.join(MASTER, srcName);
  const dst = path.join(OUT, dstName);
  try {
    // 1) resize first to target width (faster pixel loop)
    const resized = await sharp(src)
      .resize({ width, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const w = info.width, h = info.height;

    // 2) sample bg color from 4 corners + 4 edge midpoints, averaged
    const sample = (x, y) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const samples = [
      sample(0, 0),
      sample(w - 1, 0),
      sample(0, h - 1),
      sample(w - 1, h - 1),
      sample(Math.floor(w / 2), 0),
      sample(Math.floor(w / 2), h - 1),
      sample(0, Math.floor(h / 2)),
      sample(w - 1, Math.floor(h / 2)),
    ];
    const bgR = Math.round(samples.reduce((a, s) => a + s[0], 0) / samples.length);
    const bgG = Math.round(samples.reduce((a, s) => a + s[1], 0) / samples.length);
    const bgB = Math.round(samples.reduce((a, s) => a + s[2], 0) / samples.length);

    // 3) per-pixel: distance from bg → alpha ramp
    const span = hiThr - loThr;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - bgR;
      const dg = data[i + 1] - bgG;
      const db = data[i + 2] - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= loThr) {
        data[i + 3] = 0;
      } else if (dist < hiThr) {
        data[i + 3] = Math.round(255 * (dist - loThr) / span);
      }
      // else: keep existing alpha (opaque)
    }

    // 4) write back as PNG with palette off (preserves alpha gradients)
    await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .png({ compressionLevel: 9, palette: false })
      .toFile(dst);

    const stat = await fs.stat(dst);
    const transparentCount = countTransparent(data);
    const partialCount = countPartial(data);
    const total = w * h;
    console.log(
      `✓ ${dstName.padEnd(28)} ${(stat.size / 1024).toFixed(0).padStart(4)} KB  ` +
      `bg=rgb(${bgR},${bgG},${bgB})  ` +
      `α=0 ${((transparentCount / total) * 100).toFixed(1)}%  ` +
      `partial ${((partialCount / total) * 100).toFixed(2)}%`
    );
  } catch (err) {
    console.log(`✗ ${dstName}  ${err.message}`);
  }
}

function countTransparent(data) {
  let c = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) c++;
  return c;
}
function countPartial(data) {
  let c = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) c++;
  return c;
}
