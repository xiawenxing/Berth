import fg from 'fast-glob'
import { readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { PhysicalSession, LedgerRecord } from '../types'
import { deriveTitleFromTranscript } from '../agent/transcript'
import { lastMessageTime } from './transcript-time'

const TITLE_SCAN_BYTES = 8 * 1024 * 1024
const TITLE_CHUNK_BYTES = 64 * 1024
const TITLE_MAX_LINE_BYTES = 512 * 1024
const TITLE_MAX_LINES = 120

function keepTitleLine(line: string): boolean {
  if (!line.trim()) return false
  try {
    const o = JSON.parse(line)
    if (o?.type === 'session_meta') return false
  } catch {
    return false
  }
  return true
}

function readTitleSample(storePath: string): string {
  const fd = openSync(storePath, 'r')
  try {
    const buf = Buffer.alloc(TITLE_CHUNK_BYTES)
    const lines: string[] = []
    let carry = ''
    let scanned = 0
    let skippingLongLine = false
    const decoder = new StringDecoder('utf8')

    while (scanned < TITLE_SCAN_BYTES && lines.length < TITLE_MAX_LINES) {
      const toRead = Math.min(TITLE_CHUNK_BYTES, TITLE_SCAN_BYTES - scanned)
      const n = readSync(fd, buf, 0, toRead, scanned)
      if (n <= 0) break
      scanned += n

      const parts = decoder.write(buf.subarray(0, n)).split('\n')
      for (let i = 0; i < parts.length - 1; i++) {
        if (skippingLongLine) {
          skippingLongLine = false
          continue
        }
        const line = carry + parts[i]
        carry = ''
        if (line.length > TITLE_MAX_LINE_BYTES) continue
        if (keepTitleLine(line)) lines.push(line)
        if (lines.length >= TITLE_MAX_LINES) break
      }

      if (lines.length >= TITLE_MAX_LINES) break
      const tail = parts[parts.length - 1] ?? ''
      if (skippingLongLine) continue
      if (carry.length + tail.length > TITLE_MAX_LINE_BYTES) {
        carry = ''
        skippingLongLine = true
      } else {
        carry += tail
      }
    }

    const rest = decoder.end()
    if (rest && !skippingLongLine) {
      if (carry.length + rest.length > TITLE_MAX_LINE_BYTES) {
        carry = ''
        skippingLongLine = true
      } else {
        carry += rest
      }
    }
    if (!skippingLongLine && carry && carry.length <= TITLE_MAX_LINE_BYTES && keepTitleLine(carry))
      lines.push(carry)
    return lines.join('\n')
  } finally { closeSync(fd) }
}

function transcriptTitle(storePath: string): string | null {
  try { return deriveTitleFromTranscript(readTitleSample(storePath)) }
  catch { return null }
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
      title: (isStub ? null : transcriptTitle(storePath)) ?? titleById.get(meta.id) ?? meta.thread_name ?? null,
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
