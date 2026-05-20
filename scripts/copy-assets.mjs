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

const seedSrc = join(root, "seed");
const seedDst = join(root, "dist", "seed");
if (existsSync(seedSrc)) {
  mkdirSync(seedDst, { recursive: true });
  cpSync(seedSrc, seedDst, { recursive: true });
  console.log(`copied seed -> ${seedDst}`);
}
