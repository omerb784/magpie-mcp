import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src", "store", "migrations");
const dst = join(root, "dist", "store", "migrations");

if (!existsSync(src)) {
  console.error(`migrations source missing: ${src}`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copied migrations -> ${dst}`);

// Ship only the linden-loaf example bundle. The user guide (seed/user-guide/)
// is NOT bundled in npm — it lives on the site. /guide degrades to
// "Guide not bundled" in the published package by design (v1.0).
const seedSrc = join(root, "seed", "example-bundle.json");
const seedDst = join(root, "dist", "seed", "example-bundle.json");
if (existsSync(seedSrc)) {
  mkdirSync(dirname(seedDst), { recursive: true });
  cpSync(seedSrc, seedDst);
  console.log(`copied seed bundle -> ${seedDst}`);
}
