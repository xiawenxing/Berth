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
  if (existsSync(PREBUILDS)) {
    for (const platform of readdirSync(PREBUILDS)) {
      const helper = join(PREBUILDS, platform, 'spawn-helper')
      if (existsSync(helper)) {
        try { chmodSync(helper, 0o755) } catch { /* ignore */ }
      }
    }
  }
} catch { /* never block install */ }
