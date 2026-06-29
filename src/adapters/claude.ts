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

function readHead(path: string, bytes = 65536): string {
  const fd = openSync(path, 'r')
  try { const buf = Buffer.alloc(bytes); const n = readSync(fd, buf, 0, bytes, 0); return buf.toString('utf8', 0, n) }
  finally { closeSync(fd) }
}

/** Pull the real cwd (recorded in the transcript) and a human title from sampled session context. */
function extractMeta(path: string): { cwd: string | null; title: string | null } {
  let cwd: string | null = null
  let aiTitle: string | null = null
  let head: string
  try { head = readHead(path) } catch { return { cwd, title: null } }
  const title = deriveTitleFromTranscript(head)
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    // Claude persists the session title (the one shown in /resume) as an `ai-title` record. It's the
    // CLI's own native name for the session, so it takes precedence over Berth's content-derived
    // guess — and rescues sessions whose first user turn isn't in the sampled head (those would
    // otherwise render as "(未命名)"). The Berth rename override, applied at display time, still wins
    // over both.
    if (!aiTitle && o.type === 'ai-title' && typeof o.aiTitle === 'string' && o.aiTitle.trim())
      aiTitle = o.aiTitle.trim()
    if (cwd && aiTitle) break
  }
  return { cwd, title: aiTitle ?? title }
}
