import type { IPty } from 'node-pty'

/**
 * The escape sequence a TUI emits when it enables bracketed-paste mode. It is the earliest reliable
 * "I am now ready to receive input" signal a CLI gives over the PTY — the browser image-paste path
 * (web/src/lib/launch-runner.ts) already gates on this exact marker, and so do we.
 */
export const BRACKETED_PASTE_ENABLE = '\x1b[?2004h'

const READY_TIMEOUT_MS = 30_000   // safety net: type anyway if the readiness marker never shows
const SCAN_WINDOW = 4096          // bounded recent-output buffer for cross-chunk marker detection

/** Injectable timer surface so the timeout fallback is deterministic in tests. */
export interface AutoSubmitClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}
const realClock: AutoSubmitClock = {
  setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** A bracketed-paste submission of `prompt` + Enter. Newlines become CR so a multi-line prompt pastes
 *  as one block then submits — identical to the TUI image-paste path in launch-runner.ts. */
export function bracketedPaste(prompt: string): string {
  return `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r`
}

type ReadyPty = Pick<IPty, 'onData' | 'onExit' | 'write'>

/**
 * Auto-submit a fresh launch's first turn ROBUSTLY: wait until the CLI signals it is ready for input
 * (the bracketed-paste marker), THEN type the prompt. This replaces relying on the CLI to auto-submit
 * a positional-argv prompt, which races the CLI's interactive startup and silently drops the turn when
 * startup is slow (the reported "概率性 query 不自动发送" bug).
 *
 * Fires exactly once. If the marker never appears within `timeoutMs`, types anyway as a best-effort
 * fallback — strictly better than dropping the turn, and the previous positional path had no gating at
 * all. Stops on pty exit (no late submission into a dead process). Returns an idempotent cancel fn.
 */
export function autoSubmitWhenReady(
  pty: ReadyPty,
  prompt: string,
  opts: { timeoutMs?: number; clock?: AutoSubmitClock } = {},
): () => void {
  const clock = opts.clock ?? realClock
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS
  let recent = ''
  let done = false
  let timer: unknown = null
  let dataSub: { dispose(): void } | undefined
  let exitSub: { dispose(): void } | undefined

  const teardown = () => {
    if (timer != null) { clock.clearTimeout(timer); timer = null }
    try { dataSub?.dispose() } catch {}
    try { exitSub?.dispose() } catch {}
  }
  const cancel = () => {
    if (done) return
    done = true
    teardown()
  }
  const fire = () => {
    if (done) return
    done = true
    teardown()
    try { pty.write(bracketedPaste(prompt)) } catch {}
  }

  dataSub = pty.onData((d: string) => {
    if (done) return
    recent = (recent + d).slice(-SCAN_WINDOW)
    if (recent.includes(BRACKETED_PASTE_ENABLE)) fire()
  }) as { dispose(): void }
  exitSub = pty.onExit(() => cancel()) as { dispose(): void }
  timer = clock.setTimeout(fire, timeoutMs)
  return cancel
}
