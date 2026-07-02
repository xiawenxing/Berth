// Berth diagnostics: a structured event log for the launch / connection / surfacing lifecycle.
//
// Why this exists: the "fresh launch wedges in 创建中 then vanishes on reload" class of bug is
// intermittent and spans the browser, the WebSocket bridge, the PTY registry, and the disk-surfacing
// poll. A single correlated event timeline (keyed by `launchToken`/`sessionId`) is the only practical
// way to see WHERE a launch handshake breaks on a user's machine. Events are buffered in memory and
// appended to a rotating JSONL file under BERTH_HOME/logs so a user can export and send them back.
//
// Pure helpers (normalizeEvent / redactFields / pushRing) are split out and unit-tested; the file IO
// is best-effort and never throws into a caller (instrumentation must not be able to break a launch).

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { berthLogsDir } from '../paths'

export type DiagSource = 'server' | 'web'
export type DiagLevel = 'info' | 'warn' | 'error'

export interface DiagEvent {
  ts: number              // ms epoch — when the event happened
  source: DiagSource      // which side emitted it
  category: string        // coarse channel: 'launch' | 'connect' | 'resume' | 'reconcile' | 'firstturn' | 'pty' | 'ui' | ...
  event: string           // specific point: 'fresh_start' | 'launched_frame' | 'dedup_hit' | 'pending_expired' | ...
  level: DiagLevel
  launchToken?: string    // correlation key across the whole launch handshake (browser ↔ server)
  sessionId?: string      // correlation key once known
  cli?: string
  [k: string]: unknown    // event-specific fields (already redacted)
}

const RING_CAP = 5000
const FILE_MAX_BYTES = 4 * 1024 * 1024   // rotate a log file past ~4MB
const FILE_KEEP = 3                       // retain current + this many rotated files
const LOG_BASENAME = 'berth-diag.jsonl'

// Keys whose raw value is sensitive (prompt text, pasted image data) or just noisy. We keep a
// length + cheap hash so timing/identity is still debuggable without leaking content.
const REDACT_TO_DIGEST = new Set(['prompt', 'text', 'note', 'initialPrompt', 'freeText', 'taskNote'])
const DROP_KEYS = new Set(['images', 'dataUrl', 'd', 'image'])

/** Tiny non-crypto hash (djb2) — just enough to tell two distinct prompts apart in a log. */
export function cheapHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Strip/transform sensitive or bulky fields so the export is safe to hand off. Pure. */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (DROP_KEYS.has(k)) {
      if (Array.isArray(v)) out[`${k}Count`] = v.length
      continue
    }
    if (REDACT_TO_DIGEST.has(k) && typeof v === 'string') {
      out[`${k}Len`] = v.length
      if (v.length) out[`${k}Hash`] = cheapHash(v)
      continue
    }
    out[k] = v
  }
  return out
}

const RESERVED = new Set(['ts', 'source', 'category', 'event', 'level', 'launchToken', 'sessionId', 'cli'])

/** Build a complete, redacted DiagEvent from a partial. Pure (now() injected for tests). */
export function normalizeEvent(
  raw: Partial<DiagEvent> & { category: string; event: string },
  source: DiagSource,
  now: number,
): DiagEvent {
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (!RESERVED.has(k)) extras[k] = v
  const ev: DiagEvent = {
    ts: typeof raw.ts === 'number' ? raw.ts : now,
    source,
    category: String(raw.category),
    event: String(raw.event),
    level: raw.level ?? 'info',
    ...redactFields(extras),
  }
  if (raw.launchToken) ev.launchToken = String(raw.launchToken)
  if (raw.sessionId) ev.sessionId = String(raw.sessionId)
  if (raw.cli) ev.cli = String(raw.cli)
  return ev
}

/** Append to a bounded ring, dropping the oldest. Pure (mutates+returns the array). */
export function pushRing(ring: DiagEvent[], ev: DiagEvent, cap = RING_CAP): DiagEvent[] {
  ring.push(ev)
  if (ring.length > cap) ring.splice(0, ring.length - cap)
  return ring
}

// ── stateful sink ──────────────────────────────────────────────────────────
const ring: DiagEvent[] = []
let fileReady = false

function logFilePath(): string {
  return join(berthLogsDir(), LOG_BASENAME)
}

function ensureDir(): boolean {
  if (fileReady) return true
  try { mkdirSync(berthLogsDir(), { recursive: true }); fileReady = true } catch { fileReady = false }
  return fileReady
}

function rotateIfNeeded(path: string): void {
  try {
    const size = statSync(path).size
    if (size < FILE_MAX_BYTES) return
    for (let i = FILE_KEEP - 1; i >= 1; i--) {
      try { renameSync(`${path}.${i}`, `${path}.${i + 1}`) } catch {}
    }
    try { renameSync(path, `${path}.1`) } catch {}
  } catch {
    /* file doesn't exist yet → nothing to rotate */
  }
}

function appendToFile(ev: DiagEvent): void {
  if (!ensureDir()) return
  const path = logFilePath()
  try {
    rotateIfNeeded(path)
    appendFileSync(path, JSON.stringify(ev) + '\n')
  } catch {
    /* disk full / permission — instrumentation must never break the app */
  }
}

/** Record one server-side diagnostic event. Best-effort: never throws. */
export function logDiag(raw: Partial<DiagEvent> & { category: string; event: string }): void {
  try {
    const ev = normalizeEvent(raw, 'server', Date.now())
    pushRing(ring, ev)
    appendToFile(ev)
  } catch {
    /* swallow — a logging failure must not surface to the launch path */
  }
}

/** Ingest a batch of events emitted by the browser (POST /api/diag). Best-effort. */
export function ingestDiag(events: unknown): number {
  if (!Array.isArray(events)) return 0
  let n = 0
  const now = Date.now()
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.category !== 'string' || typeof r.event !== 'string') continue
    try {
      const ev = normalizeEvent(r as any, 'web', now)
      pushRing(ring, ev)
      appendToFile(ev)
      n++
    } catch { /* skip malformed */ }
  }
  return n
}

/** In-memory recent events (newest last), optionally capped. */
export function recentDiag(limit?: number): DiagEvent[] {
  if (!limit || limit >= ring.length) return ring.slice()
  return ring.slice(ring.length - limit)
}

/** Merge on-disk history (rotated files included) with the in-memory ring for export. Newest last,
 *  de-duplicated is unnecessary (the ring is the tail of the file); we prefer disk for completeness
 *  and fall back to the ring if the file is unreadable. */
export function collectDiagForExport(maxEvents = 20_000): DiagEvent[] {
  const fromDisk: DiagEvent[] = []
  try {
    const dir = berthLogsDir()
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(LOG_BASENAME))
      // current file last so its (newest) lines come after the rotated ones
      .sort((a, b) => {
        const ai = a === LOG_BASENAME ? Infinity : Number(a.split('.').pop()) || 0
        const bi = b === LOG_BASENAME ? Infinity : Number(b.split('.').pop()) || 0
        return bi - ai   // .3, .2, .1, current
      })
    for (const f of files) {
      try {
        const text = readFileSync(join(dir, f), 'utf8')
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          try { fromDisk.push(JSON.parse(line)) } catch { /* skip partial line */ }
        }
      } catch { /* skip unreadable file */ }
    }
  } catch { /* no logs dir yet */ }
  const all = fromDisk.length ? fromDisk : recentDiag()
  return all.length > maxEvents ? all.slice(all.length - maxEvents) : all
}
