import fg from 'fast-glob'
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import type { PhysicalSession } from '../types'
import { stripNoise, isInjectedText } from '../agent/transcript'
import { lastMessageTime } from './transcript-time'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TOP = new RegExp(`/(${UUID})\\.jsonl$`)
const SUB = new RegExp(`/(${UUID})/subagents/agent-[^/]+\\.jsonl$`)

export function listClaudeSessions(root: string): PhysicalSession[] {
  const files = fg.sync('**/*.jsonl', { cwd: root, absolute: true })
  const out: PhysicalSession[] = []
  for (const storePath of files) {
    const sub = storePath.match(SUB)
    if (sub) {
      out.push({ cli: 'claude', physicalId: storePath, storePath, cwd: null, title: null,
        updatedAt: lastActivity(storePath), kind: 'subagent', parentId: sub[1] })
      continue
    }
    const top = storePath.match(TOP)
    if (!top) continue
    const { cwd, title } = extractMeta(storePath)
    out.push({ cli: 'claude', physicalId: top[1], storePath, cwd, title,
      updatedAt: lastActivity(storePath), kind: 'native' })
  }
  return out
}

function mtime(p: string): number { return Math.floor(statSync(p).mtimeMs / 1000) }

/**
 * "Last activity" = the timestamp of the last real MESSAGE in the transcript (see lastMessageTime),
 * not the file mtime. Resuming/launching appends timestamp-less control records that bump the mtime
 * without adding content, so mtime would make an already-read session look unread on every resume.
 * Fall back to mtime only when the transcript carries no timestamped message at all.
 */
function lastActivity(path: string): number {
  return lastMessageTime(path) ?? mtime(path)
}

function readHead(path: string, bytes = 65536): string {
  const fd = openSync(path, 'r')
  try { const buf = Buffer.alloc(bytes); const n = readSync(fd, buf, 0, bytes, 0); return buf.toString('utf8', 0, n) }
  finally { closeSync(fd) }
}

// Extract plain text from a truncated user-message line via regex (handles base64-image lines).
// Finds the first "text":"..." value that isn't an image data URI.
const TEXT_RE = /"text":"((?:[^"\\]|\\.)*)"/g
function titleFromRawLine(line: string): string | null {
  TEXT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEXT_RE.exec(line)) !== null) {
    const raw = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\t/g, ' ').replace(/\\\\/g, '\\').trim()
    if (raw) return raw.replace(/\s+/g, ' ')
  }
  return null
}

/** Pull the real cwd (recorded in the transcript) and a human title (first user message). */
function extractMeta(path: string): { cwd: string | null; title: string | null } {
  let cwd: string | null = null, title: string | null = null
  let head: string
  try { head = readHead(path) } catch { return { cwd, title } }
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let o: any
    try { o = JSON.parse(line) } catch {
      // Truncated final line — check if it's a user message and try regex extraction
      if (!title && (line.includes('"type":"user"') || line.includes('"type": "user"'))) {
        title = titleFromRawLine(line)
      }
      continue
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    if (!title && o.type === 'user' && o.message?.role === 'user') {
      let c: any = o.message?.content
      if (Array.isArray(c)) c = c.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ')
      if (typeof c === 'string') {
        const cleaned = stripNoise(c).replace(/\s+/g, ' ').trim()
        if (cleaned && !isInjectedText(cleaned)) title = cleaned
      }
    }
    if (cwd && title) break
  }
  return { cwd, title }
}
