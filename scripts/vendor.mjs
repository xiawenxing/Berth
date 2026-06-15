#!/usr/bin/env node
// Cross-platform vendoring of the no-build frontend deps (xterm + addon-fit + marked) into
// public/vendor/, then build the lucide sprite. Replaces a POSIX `mkdir -p`/`cp` shell pipeline so
// `npm start` (which runs `npm run vendor` first) boots on Windows too.
//
// Vendored artifacts are committed, so a fresh checkout renders without running this — it's only
// needed after a dependency bump. See docs/ARCHITECTURE.md (gotcha #10).
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/vendor')

const FILES = [
  'node_modules/@xterm/xterm/css/xterm.css',
  'node_modules/@xterm/xterm/lib/xterm.js',
  'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  'node_modules/marked/lib/marked.umd.js',
]

mkdirSync(OUT, { recursive: true })
for (const rel of FILES) {
  const src = resolve(ROOT, rel)
  const dest = resolve(OUT, basename(rel))
  copyFileSync(src, dest)
  console.log(`vendored: ${basename(rel)}`)
}

// Build the lucide sprite (the module does its work at import time).
await import('./build-lucide-sprite.mjs')
