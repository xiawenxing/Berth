#!/usr/bin/env node
// node-pty ships a `spawn-helper` companion binary per platform that MUST stay executable, or every
// session launch fails silently. The old inline postinstall only chmod'd darwin-arm64 — so Intel Macs
// (darwin-x64) broke. chmod every prebuild's spawn-helper that exists. Best-effort + never fails install.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREBUILDS = join(ROOT, 'node_modules', 'node-pty', 'prebuilds')

try {
  const cli = join(ROOT, 'bin', 'berth.mjs')
  if (existsSync(cli)) chmodSync(cli, 0o755)
} catch { /* never block install */ }

try {
  if (existsSync(PREBUILDS)) {
    for (const platform of readdirSync(PREBUILDS)) {
      const helper = join(PREBUILDS, platform, 'spawn-helper')
      if (existsSync(helper)) {
        try { chmodSync(helper, 0o755) } catch { /* ignore */ }
      }
    }
  }
} catch { /* never block install */ }

// Discoverability hint: the package ships an optional Claude Code skill (berth-tasks). We don't write
// to ~/.claude automatically (that's a user-global side effect) — just point at the opt-in command.
try {
  if (existsSync(join(ROOT, 'skills', 'berth-tasks', 'SKILL.md'))) {
    console.log('berth: optional agent skill available — run `berth install skill` to enable task/project management from chat.')
  }
} catch { /* ignore */ }
