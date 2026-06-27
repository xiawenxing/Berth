import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OpenTarget = { kind: 'file'; value: string } | { kind: 'scheme'; value: string }

/**
 * Normalize a clicked local-link href into something the OS open-command can launch.
 * - `file://…`        → decoded filesystem path  (kind: 'file')
 * - `~/…`             → $HOME-expanded path       (kind: 'file')
 * - `/…`              → absolute path as-is       (kind: 'file')
 * - `scheme://…`      → passed through untouched  (kind: 'scheme')  e.g. obsidian://, vscode://
 * Anything else (relative path, http/https) is not a local target → throws.
 */
export function resolveOpenTarget(target: string): OpenTarget {
  if (target.startsWith('file://')) return { kind: 'file', value: fileURLToPath(target) }
  if (target === '~' || target.startsWith('~/')) return { kind: 'file', value: join(homedir(), target.slice(1).replace(/^\/+/, '')) }
  if (target.startsWith('/') && !target.startsWith('//')) return { kind: 'file', value: target }
  if (/^https?:\/\//i.test(target)) throw new Error('http(s) is not a local target')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) return { kind: 'scheme', value: target }
  throw new Error(`unsupported open target: ${target}`)
}

/** Platform open-command as { bin, args } — args is an array (execFile, no shell → no injection). */
export function openCommand(platform: NodeJS.Platform, value: string): { bin: string; args: string[] } {
  if (platform === 'darwin') return { bin: 'open', args: [value] }
  if (platform === 'win32') return { bin: 'cmd', args: ['/c', 'start', '', value] }
  return { bin: 'xdg-open', args: [value] }
}

/**
 * CSRF guard: only the local Berth UI may call open-local. A missing Origin means a non-browser
 * client (curl/Electron) — allowed; a present Origin must be loopback (Berth only ever serves on
 * 127.0.0.1/localhost). A drive-by page on another origin is rejected.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
