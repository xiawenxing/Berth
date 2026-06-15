#!/usr/bin/env node
// Build the Electron installer in an ISOLATED git worktree so the dev tree's node_modules is never
// touched. The native ABI problem: a compiled .node embeds one NODE_MODULE_VERSION; a flat node_modules
// has one slot per native package. electron-builder's npmRebuild (default true) recompiles
// better-sqlite3/node-pty IN PLACE against Electron's ABI — which would break `npm test`/`npm start`
// (node ABI). Building inside a throwaway worktree (its own node_modules, rebuilt for Electron there)
// keeps the dev tree on node's ABI. The .dmg/.zip artifacts are copied back to ./release.
//
// Run on macOS with the toolchain installed. Heavy (a full npm ci + native rebuild + electron-builder).
import { execFileSync } from 'node:child_process'
import { mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WT = join(ROOT, '..', 'berth-electron-build')   // sibling dir; matches the repo's worktree convention
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

// Clean any stale worktree, then create a fresh one at HEAD.
try { run('git', ['worktree', 'remove', '--force', WT], ROOT) } catch { /* none */ }
run('git', ['worktree', 'add', '--force', WT, 'HEAD'], ROOT)

try {
  run('npm', ['ci'], WT)                 // fresh, isolated node_modules (node ABI here — irrelevant, we rebuild next)
  run('npm', ['run', 'build'], WT)       // vendor + esbuild → dist/
  // electron-builder rebuilds the natives for Electron's ABI INSIDE the worktree's node_modules.
  run('npx', ['electron-builder', '--config', 'electron-builder.yml'], WT)

  const srcRelease = join(WT, 'release')
  const dstRelease = join(ROOT, 'release')
  if (existsSync(srcRelease)) {
    mkdirSync(dstRelease, { recursive: true })
    for (const f of readdirSync(srcRelease)) cpSync(join(srcRelease, f), join(dstRelease, f), { recursive: true })
    console.log(`\n✓ artifacts copied to ${dstRelease}`)
  } else {
    console.error('electron-builder produced no release/ dir')
    process.exit(1)
  }
} finally {
  // Always remove the worktree so the dev tree stays clean.
  try { run('git', ['worktree', 'remove', '--force', WT], ROOT) } catch { /* best effort */ }
  if (existsSync(WT)) rmSync(WT, { recursive: true, force: true })
}
