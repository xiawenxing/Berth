#!/usr/bin/env node
// Compile the TypeScript core to runnable ESM in dist/ with esbuild. We bundle our own src (resolving
// the repo's extensionless ESM imports, which plain `tsc` emit would leave Node-unresolvable) but keep
// all npm deps EXTERNAL — native addons (better-sqlite3, node-pty) and CJS deps must be required from
// node_modules at runtime, not inlined. Type-checking is a separate `tsc --noEmit` (run in tests/CI).
//
// Two entry points share code via splitting: dist/cli.js (the `berth` CLI) and dist/server/index.js
// (imported by both the CLI and electron/main.cjs). import.meta.url-based public/ resolution still
// works because resolvePublicDir() walks up to the package root (see src/server/public-dir.ts).
import { build } from 'esbuild'

await build({
  entryPoints: ['src/cli.ts', 'src/server/index.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
