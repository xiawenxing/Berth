import { openSync, readSync, closeSync, fstatSync } from 'node:fs'

/**
 * The epoch-seconds of the last REAL message in a transcript — the timestamp of the last line that
 * carries one — or null if none does. This is the content-based "last activity" signal: resuming or
 * launching a session appends timestamp-less control records (permission-mode, mode, ai-title) and a
 * resize triggers a full screen repaint, but NONE of those add a timestamped message. So this value
 * only advances when the agent actually says something new — exactly what "unread" should track.
 */
export function lastMessageTime(path: string): number | null {
  let tail: string
  try { tail = readTail(path, 65536) } catch { return null }
  const lines = tail.split('\n')
  let fallback: number | null = null   // a single-object store's updated_at (coco session.json)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }   // the first tail line may be partial
    if (typeof o.timestamp === 'string') {
      const t = Date.parse(o.timestamp)
      if (!Number.isNaN(t)) return Math.floor(t / 1000)   // per-line message timestamp always wins
    }
    // coco stores no per-line timestamps — its session.json is one JSON object with `updated_at`.
    // Keep it only as a fallback so a JSONL transcript's real message time is never overridden.
    if (fallback == null) {
      const raw = o.updated_at ?? o.updatedAt
      if (typeof raw === 'string') { const t = Date.parse(raw); if (!Number.isNaN(t)) fallback = Math.floor(t / 1000) }
    }
  }
  return fallback
}

function readTail(path: string, bytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const len = size - start
    if (len <= 0) return ''
    const buf = Buffer.alloc(len)
    const n = readSync(fd, buf, 0, len, start)
    return buf.toString('utf8', 0, n)
  } finally { closeSync(fd) }
}
