// Detached session-title generation + an in-flight registry. The title agent call runs decoupled from
// the HTTP request that kicked it (fire-and-forget), so closing the drawer / navigating away never
// stops it; the title persists as a normal override and surfaces on the next /api/sessions read.
// GET /api/sessions reports `titleGenerating` from this registry so the UI can show a live spinner.

import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { getStore, getCache } from './store-singleton'
import { resolveBerthAgent } from '../data/agent-config'
import { generateTitle } from '../agent/index'
import { titleInputFromTranscript } from '../agent/transcript'

const inFlight = new Set<string>()
export function isGeneratingTitle(id: string): boolean { return inFlight.has(id) }

/** Read a bounded head+tail sample of a (possibly huge) transcript file for title inference. */
export function readTitleTranscriptSample(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const maxBytes = 1024 * 1024
    if (size <= maxBytes) {
      const b = Buffer.alloc(size)
      const n = readSync(fd, b, 0, size, 0)
      return b.toString('utf8', 0, n)
    }
    const headBytes = 256 * 1024
    const tailBytes = maxBytes - headBytes
    const head = Buffer.alloc(headBytes)
    const hn = readSync(fd, head, 0, headBytes, 0)
    const tailStart = Math.max(0, size - tailBytes)
    const tail = Buffer.alloc(size - tailStart)
    const tn = readSync(fd, tail, 0, tail.length, tailStart)
    let tailText = tail.toString('utf8', 0, tn)
    const firstNewline = tailText.indexOf('\n')
    if (tailStart > 0 && firstNewline >= 0) tailText = tailText.slice(firstNewline + 1)
    return head.toString('utf8', 0, hn) + '\n' + tailText
  } finally {
    closeSync(fd)
  }
}

/** The condensed gist a title would be generated from, or null if the session has no usable content
 *  (lets the POST fail fast with 422 before kicking a no-op background run). */
export function titleGist(sessionId: string): string | null {
  const s = getCache().find(x => x.sessionId === sessionId)
  if (!s || !s.contentSourcePath) return null
  let sample = ''
  try { sample = readTitleTranscriptSample(s.contentSourcePath) } catch {}
  return titleInputFromTranscript(sample) || null
}

async function generateSessionTitle(sessionId: string): Promise<void> {
  const gist = titleGist(sessionId)
  if (!gist) return
  const title = await generateTitle(gist, resolveBerthAgent(getStore()))
  if (title) getStore().setTitleOverride(sessionId, title)
}

/** Fire-and-forget (re)generation. The in-flight flag is set synchronously (so a reload right after
 *  the POST already shows the spinner), the agent call is deferred to a microtask and detached from
 *  the request. Dedups per session; errors are swallowed (the spinner just clears, title unchanged). */
export function triggerSessionTitle(sessionId: string): void {
  if (inFlight.has(sessionId)) return
  inFlight.add(sessionId)
  queueMicrotask(() => {
    void generateSessionTitle(sessionId).catch(() => {}).finally(() => inFlight.delete(sessionId))
  })
}
