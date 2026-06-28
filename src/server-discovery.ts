import { writeFileSync, readFileSync, rmSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { berthHome } from './paths'

export interface ServerAddress { port: number; host: string; pid?: number; startedAt?: number; version?: string }

export function serverFilePath(): string { return join(berthHome(), 'server.json') }

/** True if a process with this pid is alive (signal 0 probes without killing). */
function pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (e: any) { return e?.code === 'EPERM' } }

export function writeServerFile(addr: ServerAddress): void {
  const rec = { ...addr, pid: addr.pid ?? process.pid, startedAt: addr.startedAt ?? Date.now() }
  const tmp = serverFilePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(rec))
  renameSync(tmp, serverFilePath())
}

/** Read the recorded address, or null if missing/corrupt/stale (dead pid). */
export function readServerFile(): ServerAddress | null {
  const p = serverFilePath()
  if (!existsSync(p)) return null
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8')) as ServerAddress
    if (rec.pid != null && !pidAlive(rec.pid)) return null
    return rec
  } catch { return null }
}

export function removeServerFile(): void { try { rmSync(serverFilePath(), { force: true }) } catch {} }
