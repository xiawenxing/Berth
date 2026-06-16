#!/usr/bin/env node
// Executable entry for the published `berth` CLI. Hand-authored ESM (shipped as-is, not compiled) so
// it can carry the shebang and read the package version. Delegates to the compiled core in ../dist.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version } = require('../package.json')
const { runCli } = await import('../dist/cli.js')
runCli(process.argv.slice(2), version).catch((e) => { console.error(e); process.exit(1) })
