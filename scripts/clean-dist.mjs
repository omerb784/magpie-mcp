#!/usr/bin/env node
// Wipes dist/ before a fresh build. Prevents orphaned files (renamed/removed sources,
// stale source maps from prior sourceMap=true builds) from sneaking into the tarball.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'dist');
rmSync(target, { recursive: true, force: true });
console.log(`cleaned ${target}`);
