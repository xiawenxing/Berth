import fg from 'fast-glob'
import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type { PhysicalSession, LedgerRecord } from '../types'
import { stripNoise, isInjectedText } from '../agent/transcript'
import { lastMessageTime } from './transcript-time'

function firstUserTitle(storePath: string): string | null {
  let head: string
  try {
    const fd = openSync(storePath, 'r'); const buf = Buffer.alloc(131072)
    const n = readSync(fd, buf, 0, 131072, 0); closeSync(fd); head = buf.toString('utf8', 0, n)
  } catch { return null }
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let o: any; try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'response_item') continue
    const p = o.payload
    if (p?.type === 'message' && p.role === 'user') {
      const raw = (Array.isArray(p.content) ? p.content.map((c: any) => c?.text ?? '').join(' ') : '').trim()
      const cleaned = stripNoise(raw).replace(/\s+/g, ' ').trim()
      if (!cleaned) continue
      // Also keep the existing codex-specific injection markers
      if (isInjectedText(cleaned) || cleaned.startsWith('#') ||
          /AGENTS\.md|BERTH_SENTINEL|treat as reference|Context for this task/i.test(cleaned.slice(0, 80))) continue
      return cleaned
    }
  }
  return null
}

const STUB_PREFIX = 'Imported from Claude Code session:'

export function listCodexSessions(root: string): PhysicalSession[] {
  // Authoritative list = glob the rollouts, NOT session_index.jsonl (it drops ~10%).
  const files = fg.sync('sessions/**/rollout-*.jsonl', { cwd: root, absolute: true })
  const out: PhysicalSession[] = []
  const titleById = new Map<string, string>()
  try {
    for (const line of readFileSync(join(root, 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { const r = JSON.parse(line); if (r.id && r.thread_name) titleById.set(r.id, r.thread_name) } catch {}
    }
  } catch {}
  for (const storePath of files) {
    const firstLine = readFileSync(storePath, 'utf8').split('\n', 1)[0]
    if (!firstLine) continue
    const meta = JSON.parse(firstLine).payload ?? {}
    if (!meta.id) continue
    const baseText: string = meta.base_instructions?.text ?? ''
    const isStub = baseText.startsWith(STUB_PREFIX)
    out.push({
      cli: 'codex',
      physicalId: meta.id,
      storePath,
      cwd: meta.cwd ?? null,
      title: (isStub ? null : firstUserTitle(storePath)) ?? titleById.get(meta.id) ?? meta.thread_name ?? null,
      // session_meta.timestamp is the session CREATION time and never advances; the rollout carries a
      // top-level `timestamp` on every line, so date from the LAST message (like claude) and fall back
      // to creation time only for an empty rollout. Otherwise unread can't re-light and ordering rots.
      updatedAt: lastMessageTime(storePath) ?? (Math.floor(new Date(meta.timestamp ?? 0).getTime() / 1000) || 0),
      kind: isStub ? 'import-stub' : 'native',
      importedFromPath: isStub ? baseText.slice(STUB_PREFIX.length).trim() : undefined,
    })
  }
  return out
}

export function loadImportLedger(root: string): LedgerRecord[] {
  let raw: string
  try { raw = readFileSync(join(root, 'external_agent_session_imports.json'), 'utf8') }
  catch { return [] }
  const recs = JSON.parse(raw).records ?? []
  return recs.map((r: any): LedgerRecord => ({
    sourcePath: r.source_path,
    contentSha256: r.content_sha256,
    importedThreadId: r.imported_thread_id,
    importedAt: typeof r.imported_at === 'number' ? Math.floor(r.imported_at) : Number(r.imported_at) || 0,
  }))
}
