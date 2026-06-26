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
const capture = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const allowUnnotarizedMac = process.env.BERTH_ALLOW_UNNOTARIZED_MAC === '1'

function completeEnvGroup(names) {
  return names.every(name => Boolean(process.env[name]))
}

function partialEnvGroup(names) {
  return names.some(name => Boolean(process.env[name])) && !completeEnvGroup(names)
}

function hasDeveloperIdIdentity() {
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true
  try {
    return /Developer ID Application/.test(capture('security', ['find-identity', '-v', '-p', 'codesigning'], ROOT))
  } catch {
    return false
  }
}

function hasNotarizationCredentials() {
  const apiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
  const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  const keychain = ['APPLE_KEYCHAIN_PROFILE']
  const partialGroups = [apiKey, appleId].filter(partialEnvGroup)
  if (process.env.APPLE_KEYCHAIN && !process.env.APPLE_KEYCHAIN_PROFILE) partialGroups.push(['APPLE_KEYCHAIN_PROFILE'])
  if (partialGroups.length) {
    const missing = partialGroups.flatMap(group => group.filter(name => !process.env[name]))
    throw new Error(`Incomplete Apple notarization environment. Missing: ${[...new Set(missing)].join(', ')}`)
  }
  return completeEnvGroup(apiKey) || completeEnvGroup(appleId) || completeEnvGroup(keychain)
}

function assertMacReleaseReady() {
  if (process.platform !== 'darwin') return
  if (allowUnnotarizedMac) {
    console.warn('BERTH_ALLOW_UNNOTARIZED_MAC=1: building an ad-hoc signed, unnotarized macOS installer.')
    console.warn('Users will need to approve the app manually in macOS Gatekeeper.')
    return
  }
  const missing = []
  if (!hasDeveloperIdIdentity()) missing.push('Developer ID Application signing identity (keychain, CSC_LINK, or CSC_NAME)')
  if (!hasNotarizationCredentials()) {
    missing.push('Apple notarization credentials: APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE')
  }
  if (missing.length) {
    throw new Error(
      `Refusing to build an unsigned/unnotarized macOS release.\n` +
      `Missing:\n- ${missing.join('\n- ')}\n\n` +
      `Set BERTH_ALLOW_UNNOTARIZED_MAC=1 to build an ad-hoc signed DMG that users must open manually.`
    )
  }
}

function verifyMacApps(releaseDir) {
  if (process.platform !== 'darwin' || !existsSync(releaseDir)) return
  let verified = 0
  for (const dir of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('mac')) continue
    const dirPath = join(releaseDir, dir.name)
    for (const entry of readdirSync(dirPath)) {
      if (!entry.endsWith('.app')) continue
      const appPath = join(dirPath, entry)
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], ROOT)
      if (!allowUnnotarizedMac) run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], ROOT)
      verified++
    }
  }
  if (verified === 0) throw new Error(`No macOS .app bundle found under ${releaseDir}; cannot verify release signing.`)
}

function electronBuilderArgs() {
  const args = ['electron-builder', '--config', 'electron-builder.yml']
  if (process.platform === 'darwin' && allowUnnotarizedMac) {
    args.push(
      '-c.mac.identity=-',
      '-c.mac.notarize=false',
      '-c.mac.forceCodeSigning=false',
      '-c.mac.hardenedRuntime=false'
    )
  }
  return args
}

// Clean any stale worktree, then create a fresh one at HEAD.
assertMacReleaseReady()
try { run('git', ['worktree', 'remove', '--force', WT], ROOT) } catch { /* none */ }
run('git', ['worktree', 'add', '--force', WT, 'HEAD'], ROOT)

try {
  run('npm', ['ci'], WT)                 // fresh, isolated node_modules (node ABI here — irrelevant, we rebuild next)
  run('npm', ['run', 'build'], WT)       // vendor + esbuild → dist/
  // electron-builder rebuilds the natives for Electron's ABI INSIDE the worktree's node_modules.
  run('npx', electronBuilderArgs(), WT)

  const srcRelease = join(WT, 'release')
  verifyMacApps(srcRelease)
  const dstRelease = join(ROOT, 'release')
  if (existsSync(srcRelease)) {
    mkdirSync(dstRelease, { recursive: true })
    for (const f of readdirSync(srcRelease, { withFileTypes: true })) {
      if (f.isDirectory() && f.name.startsWith('mac')) continue
      cpSync(join(srcRelease, f.name), join(dstRelease, f.name), { recursive: true })
    }
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
