import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { berthHome } from '../paths'

export const DEFAULT_PTY_REPLAY_BYTES = 16 * 1024 * 1024
export const MAX_PTY_REPLAY_BYTES = 64 * 1024 * 1024

function clampBytes(n: unknown, fallback = DEFAULT_PTY_REPLAY_BYTES): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(Math.floor(v), MAX_PTY_REPLAY_BYTES)
}

export function parsePtyReplayBytes(v: unknown): number {
  return clampBytes(v)
}

function safeName(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'session'
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12)
  return `${clean}-${hash}.ansi`
}

export function ptySpoolPath(key: string): string {
  return join(berthHome(), 'pty-streams', safeName(key))
}

export function readPtySpoolTail(key: string, bytes: number = DEFAULT_PTY_REPLAY_BYTES): string {
  const path = ptySpoolPath(key)
  if (!existsSync(path)) return ''
  const max = clampBytes(bytes)
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = statSync(path).size
    const start = Math.max(0, size - max)
    const buf = Buffer.alloc(size - start)
    const n = readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd != null) closeSync(fd)
  }
}

export function rekeyPtySpool(oldKey: string, newKey: string): void {
  const oldPath = ptySpoolPath(oldKey)
  if (!existsSync(oldPath)) return
  const newPath = ptySpoolPath(newKey)
  if (oldPath === newPath) return
  try {
    mkdirSync(dirname(newPath), { recursive: true })
    if (existsSync(newPath)) {
      const oldBytes = readFileSync(oldPath)
      const fd = openSync(newPath, 'a')
      try { writeSync(fd, oldBytes) } finally { closeSync(fd) }
      unlinkSync(oldPath)
    } else {
      renameSync(oldPath, newPath)
    }
  } catch {}
}

export class PtySpool {
  private path: string
  private fd: number | null = null

  constructor(private key: string) {
    this.path = ptySpoolPath(key)
  }

  append(data: string): void {
    if (!data) return
    try {
      if (this.fd == null) {
        mkdirSync(dirname(this.path), { recursive: true })
        this.fd = openSync(this.path, 'a')
      }
      writeSync(this.fd, data)
    } catch {}
  }

  snapshot(bytes: number = DEFAULT_PTY_REPLAY_BYTES): string {
    return readPtySpoolTail(this.key, bytes)
  }

  rekey(newKey: string): void {
    if (newKey === this.key) return
    this.close()
    rekeyPtySpool(this.key, newKey)
    this.key = newKey
    this.path = ptySpoolPath(newKey)
  }

  close(): void {
    if (this.fd == null) return
    try { closeSync(this.fd) } catch {}
    this.fd = null
  }
}
