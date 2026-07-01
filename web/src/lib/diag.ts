// Browser-side diagnostics: mirror of the server diag bus for the half of the launch handshake that
// only the browser sees (drawer open/close timing, prime/viewer socket lifecycle, the pending-poll
// surfacing/expiry). Events are buffered and flushed to POST /api/diag so the server export bundles
// ONE correlated timeline (keyed by launchToken/sessionId) across both sides. Best-effort: a logging
// failure must never disturb a launch. Prefer logging lengths/booleans over raw content — the server
// redacts as a backstop, but we don't ship prompt text here in the first place.

export interface WebDiagEvent {
  ts: number
  category: string
  event: string
  launchToken?: string
  sessionId?: string
  cli?: string
  level?: 'info' | 'warn' | 'error'
  [k: string]: unknown
}

const FLUSH_DELAY_MS = 1500
const BUFFER_CAP = 1000

let buffer: WebDiagEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Drop the oldest when over cap, so a failed/slow flush can't grow unbounded. Pure (exported for test). */
export function capBuffer(buf: WebDiagEvent[], cap = BUFFER_CAP): WebDiagEvent[] {
  return buf.length > cap ? buf.slice(buf.length - cap) : buf
}

function scheduleFlush(): void {
  if (flushTimer != null || typeof window === 'undefined') return
  flushTimer = setTimeout(() => { void flush() }, FLUSH_DELAY_MS)
}

/** Record a browser-side diagnostic event. */
export function logDiag(category: string, event: string, fields?: Record<string, unknown>): void {
  try {
    buffer.push({ ts: Date.now(), category, event, ...fields })
    buffer = capBuffer(buffer)
    scheduleFlush()
  } catch { /* never throw into the caller */ }
}

/** Flush the buffer to the server. On failure the batch is re-queued (capped) for the next attempt. */
export async function flush(): Promise<void> {
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null }
  if (!buffer.length || typeof fetch === 'undefined') return
  const batch = buffer
  buffer = []
  try {
    await fetch('/api/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,   // let it complete even if the page is unloading
    })
  } catch {
    buffer = capBuffer([...batch, ...buffer])   // requeue for next attempt
  }
}

/** Flush pending web events, then download the merged (server + web) diagnostic bundle. */
export async function exportDiagLog(): Promise<void> {
  if (typeof window === 'undefined') return
  try { await flush() } catch { /* still export what the server already has */ }
  const a = document.createElement('a')
  a.href = '/api/diag/export'
  a.download = ''   // let the server's Content-Disposition name it
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Flush on tab hide / unload so an in-progress investigation isn't lost when the user closes the tab.
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush() })
  window.addEventListener('pagehide', () => { void flush() })
}
