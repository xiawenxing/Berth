import fg from 'fast-glob'
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import type { PhysicalSession } from '../types'
import { deriveTitleFromTranscript } from '../agent/transcript'
import { lastMessageTime } from './transcript-time'
import { createMtimeCache, type MtimeCache } from './mtime-cache'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TOP = new RegExp(`/(${UUID})\\.jsonl$`)
const SUB = new RegExp(`/(${UUID})/subagents/agent-[^/]+\\.jsonl$`)

function buildClaudeSession(storePath: string): PhysicalSession | null {
  const sub = storePath.match(SUB)
  if (sub) {
    return { cli: 'claude', physicalId: storePath, storePath, cwd: null, title: null,
      updatedAt: lastActivity(storePath), kind: 'subagent', parentId: sub[1] }
  }
  const top = storePath.match(TOP)
  if (!top) return null
  const { cwd, title } = extractMeta(storePath)
  return { cli: 'claude', physicalId: top[1], storePath, cwd, title,
    updatedAt: lastActivity(storePath), kind: 'native' }
}

// One process-lifetime cache: claude transcripts are append-only, so an unchanged mtime means an
// unchanged parse — the ~430MB content re-read per scan collapses to a stat walk.
const claudeCache = createMtimeCache<PhysicalSession | null>()

export function listClaudeSessions(root: string, cache: MtimeCache<PhysicalSession | null> = claudeCache): PhysicalSession[] {
  const files = fg.sync('**/*.jsonl', { cwd: root, absolute: true })
  const out: PhysicalSession[] = []
  for (const storePath of files) {
    const sess = cache.resolve(storePath, () => buildClaudeSession(storePath))
    if (sess) out.push(sess)
  }
  cache.prune(files)
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

const HEAD_BYTES = 65536
// Upper bound for the metadata scan. Claude doesn't guarantee a `cwd` record near the top: a session
// continued from a compaction point opens with dozens of `file-history-snapshot` records, and some
// open with large `api-request-*` blobs — the first `cwd` was seen at ~180KB in the wild. 2MB covers
// that with plenty of headroom while still bounding the read on pathological files.
const META_SCAN_MAX_BYTES = 2 * 1024 * 1024
const SCAN_CHUNK_BYTES = 65536

function readAt(path: string, offset: number, bytes: number): string {
  const fd = openSync(path, 'r')
  try { const buf = Buffer.alloc(bytes); const n = readSync(fd, buf, 0, bytes, offset); return buf.toString('utf8', 0, n) }
  finally { closeSync(fd) }
}

interface MetaScan { cwd: string | null; aiTitle: string | null; firstUserOffset: number | null }

/**
 * Walk the transcript line by line (chunked reads, never past `maxBytes`) collecting the first `cwd`,
 * the native `ai-title`, and the byte offset of the first user turn. Stops once it has the cwd and
 * either the ai-title or the first user turn — but never before covering the historical 64KB head,
 * since an `ai-title` record is often written after the first user turn.
 */
export function scanClaudeMeta(path: string, maxBytes = META_SCAN_MAX_BYTES): MetaScan {
  const out: MetaScan = { cwd: null, aiTitle: null, firstUserOffset: null }
  let consumed = 0 // file offset just past the last fully handled line
  const done = () => out.cwd !== null &&
    (out.aiTitle !== null || (out.firstUserOffset !== null && consumed >= HEAD_BYTES))
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(SCAN_CHUNK_BYTES)
    let pending = Buffer.alloc(0) // bytes of the current, not-yet-terminated line
    let pendingOffset = 0          // file offset where `pending` starts
    let pos = 0
    const handle = (line: Buffer, offset: number) => {
      const text = line.toString('utf8')
      if (!text.trim()) return
      let o: any
      try { o = JSON.parse(text) } catch { return }
      if (out.cwd === null && typeof o.cwd === 'string') out.cwd = o.cwd
      // Claude persists the session title (the one shown in /resume) as an `ai-title` record. It's
      // the CLI's own native name for the session, so it takes precedence over Berth's
      // content-derived guess. The Berth rename override, applied at display time, still wins.
      if (out.aiTitle === null && o.type === 'ai-title' && typeof o.aiTitle === 'string' && o.aiTitle.trim())
        out.aiTitle = o.aiTitle.trim()
      if (out.firstUserOffset === null && o.type === 'user' && o.message?.role === 'user')
        out.firstUserOffset = offset
    }
    while (pos < maxBytes && !done()) {
      const n = readSync(fd, buf, 0, Math.min(SCAN_CHUNK_BYTES, maxBytes - pos), pos)
      if (n <= 0) break
      const chunk = buf.subarray(0, n)
      let start = 0
      for (let i = chunk.indexOf(10); i !== -1 && !done(); i = chunk.indexOf(10, start)) {
        const piece = chunk.subarray(start, i)
        const line = pending.length ? Buffer.concat([pending, piece]) : piece
        handle(line, pending.length ? pendingOffset : pos + start)
        pending = Buffer.alloc(0)
        start = i + 1
        consumed = pos + start
      }
      if (!done() && start < n) {
        if (!pending.length) pendingOffset = pos + start
        pending = Buffer.concat([pending, chunk.subarray(start)])
      }
      pos += n
    }
    // Last line of a file without a trailing newline (only if we actually reached EOF).
    if (!done() && pending.length && pos < maxBytes) handle(pending, pendingOffset)
  } finally { closeSync(fd) }
  return out
}

/** Pull the real cwd (recorded in the transcript) and a human title from sampled session context. */
function extractMeta(path: string): { cwd: string | null; title: string | null } {
  let scan: MetaScan
  try { scan = scanClaudeMeta(path) } catch { return { cwd: null, title: null } }
  if (scan.aiTitle) return { cwd: scan.cwd, title: scan.aiTitle }
  // Derive the title from a 64KB window. Keep the historical window (file start) when the first user
  // turn falls inside it; otherwise slide the window to start at that turn so sessions with a large
  // metadata preamble still get a real title instead of "(未命名)".
  let title: string | null = null
  try {
    const start = scan.firstUserOffset !== null && scan.firstUserOffset >= HEAD_BYTES ? scan.firstUserOffset : 0
    title = deriveTitleFromTranscript(readAt(path, start, HEAD_BYTES))
  } catch { /* unreadable → untitled */ }
  return { cwd: scan.cwd, title }
}
