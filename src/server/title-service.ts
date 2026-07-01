// Detached session-title generation + an in-flight registry. The title agent call runs decoupled from
// the HTTP request that kicked it (fire-and-forget), so closing the drawer / navigating away never
// stops it; the title persists as a normal override and surfaces on the next /api/sessions read.
// GET /api/sessions reports `titleGenerating` from this registry so the UI can show a live spinner.

import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { getStore, getCache } from './store-singleton'
import { resolveBerthAgent } from '../data/agent-config'
import { generateTitle } from '../agent/index'
import { titleInputFromTranscript } from '../agent/transcript'
import { logDiag } from './diag'
import { compactTitle } from '../title-limits'

const inFlight = new Set<string>()
export function isGeneratingTitle(id: string): boolean { return inFlight.has(id) }

function readAlignedChunk(fd: number, start: number, length: number, fileSize: number): string {
  const b = Buffer.alloc(length)
  const n = readSync(fd, b, 0, length, start)
  let text = b.toString('utf8', 0, n)
  if (start > 0) {
    const firstNewline = text.indexOf('\n')
    text = firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
  }
  if (start + n < fileSize) {
    const lastNewline = text.lastIndexOf('\n')
    text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
  }
  return text
}

/** Read a bounded head/middle/tail sample of a (possibly huge) transcript file for title inference. */
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
    const chunkBytes = Math.floor(maxBytes / 3)
    const head = readAlignedChunk(fd, 0, chunkBytes, size)
    const middleStart = Math.max(0, Math.floor(size / 2 - chunkBytes / 2))
    const middle = readAlignedChunk(fd, middleStart, chunkBytes, size)
    const tailStart = Math.max(0, size - chunkBytes)
    const tail = readAlignedChunk(fd, tailStart, chunkBytes, size)
    return [head, middle, tail].filter(Boolean).join('\n')
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
  if (!gist) {
    logDiag({ category: 'title', event: 'no_gist', sessionId, level: 'warn' })
    return
  }
  logDiag({ category: 'title', event: 'agent_start', sessionId, gistLen: gist.length })
  const title = await generateTitle(gist, resolveBerthAgent(getStore()))
  if (!title) {
    logDiag({ category: 'title', event: 'empty_result', sessionId, level: 'warn' })
    return
  }
  const saved = compactTitle(title)
  getStore().setTitleOverride(sessionId, saved)
  logDiag({ category: 'title', event: 'saved', sessionId, titleLen: saved.length })
}

/** Fire-and-forget (re)generation. The in-flight flag is set synchronously (so a reload right after
 *  the POST already shows the spinner), the agent call is deferred to a microtask and detached from
 *  the request. Dedups per session; errors are swallowed (the spinner just clears, title unchanged). */
export function triggerSessionTitle(sessionId: string): void {
  if (inFlight.has(sessionId)) {
    logDiag({ category: 'title', event: 'dedupe', sessionId })
    return
  }
  inFlight.add(sessionId)
  logDiag({ category: 'title', event: 'start', sessionId })
  queueMicrotask(() => {
    void generateSessionTitle(sessionId)
      .catch((e: any) => logDiag({ category: 'title', event: 'failed', sessionId, level: 'error', error: String(e?.message ?? e) }))
      .finally(() => {
        inFlight.delete(sessionId)
        logDiag({ category: 'title', event: 'finish', sessionId })
      })
  })
}
