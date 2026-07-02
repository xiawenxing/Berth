#!/usr/bin/env node
// Compile the TypeScript core to runnable ESM in dist/ with esbuild. We bundle our own src (resolving
// the repo's extensionless ESM imports, which plain `tsc` emit would leave Node-unresolvable) but keep
// all npm deps EXTERNAL — native addons (better-sqlite3, node-pty) and CJS deps must be required from
// node_modules at runtime, not inlined. Type-checking is a separate `tsc --noEmit` (run in tests/CI).
//
// Entry points share code via splitting: dist/cli.js (the `berth` CLI), dist/server/index.js (the
// server core, imported by the CLI and electron/server-process.cjs), and dist/server-resolve.js (the
// reuse-discovery helper electron/main.cjs imports to decide whether to spawn a server at all).
// import.meta.url-based public/ resolution still works because resolvePublicDir() walks up to the
// package root (see src/server/public-dir.ts).
import { build } from 'esbuild'

await build({
  entryPoints: ['src/cli.ts', 'src/server/index.ts', 'src/server-resolve.ts'],
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
