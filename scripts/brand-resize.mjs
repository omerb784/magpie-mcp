#!/usr/bin/env node
import sharp from "sharp";
import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "assets", "brand", "source");
const OUT_DIR = join(ROOT, "assets", "brand", "output");

const SIZES = [16, 32, 48, 64, 96, 128, 152, 167, 180, 192, 256, 384, 512, 1024];

async function resizeOne(srcPath) {
  const name = basename(srcPath, extname(srcPath));
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = join(OUT_DIR, name);
  await mkdir(outDir, { recursive: true });

  console.log(`\n[${name}] source: ${srcPath}`);
  const meta = await sharp(srcPath).metadata();
  console.log(`  master: ${meta.width}x${meta.height} ${meta.format}`);

  for (const size of SIZES) {
    const out = join(outDir, `${name}-${size}.png`);
    await sharp(srcPath)
      .resize(size, size, { fit: "contain", background: { r: 244, g: 241, b: 232, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`  -> ${size}x${size}  ${out.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
  }

  const transOut = join(outDir, `${name}-512-transparent.png`);
  await sharp(srcPath)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(transOut);
  console.log(`  -> 512x512 transparent  ${basename(transOut)}`);

  console.log(`[${name}] done ${stamp}`);
}

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`source dir missing: ${SRC_DIR}`);
    process.exit(1);
  }
  const files = (await readdir(SRC_DIR))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => join(SRC_DIR, f));

  if (files.length === 0) {
    console.error(`no PNG/JPG/WEBP files in ${SRC_DIR}`);
    process.exit(1);
  }

  console.log(`brand-resize: ${files.length} source file(s) -> ${SIZES.length} sizes each`);
  for (const f of files) await resizeOne(f);
  console.log(`\nall outputs in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
