// The resume-spawn-register sequence, shared by the /pty resume branch and the boot warm pool so
// both spawn + register a resumed agent identically. Lives in its own module to keep pty-ws.ts and
// warm-pool.ts free of an import cycle (pty-ws → resume-spawn ← warm-pool).
import type { IPty } from 'node-pty'
import { resumeSession } from '../pty/launch'
import { registerPty } from './pty-registry'
import { getCache } from './store-singleton'
import { latestCodexTurnState, type CodexTurnState } from '../adapters/codex-turn'
import type { LogicalSession } from '../types'

/** A codex hold-running probe: codex emits no clear turn-start marker, so we poll its turn-state
 *  file to decide whether the spinner should stay lit after a resume. Other CLIs don't need it. */
export function codexHoldRunning(initialState: CodexTurnState = 'unknown') {
  let lastState = initialState
  return (sessionId: string): boolean => {
    const s = getCache().find(x => x.sessionId === sessionId)
    const next = s?.contentSourcePath ? latestCodexTurnState(s.contentSourcePath) : 'unknown'
    if (next !== 'unknown') lastState = next
    return lastState === 'running'
  }
}

export function codexActivityStateForSession(s: Pick<LogicalSession, 'cli' | 'contentSourcePath'>): CodexTurnState {
  if (s.cli !== 'codex' || !s.contentSourcePath) return 'unknown'
  return latestCodexTurnState(s.contentSourcePath)
}

/**
 * Spawn a `--resume` agent for `s` and register it in the pty registry with the correct initial
 * running state (codex's turn-state probe; other CLIs start settled). Returns the live pty. Used by
 * the /pty resume branch (passive open) and the warm pool (boot pre-spawn). `onExit` lets the warm
 * pool drop the session from its bookkeeping when the agent ends on its own.
 */
export function spawnAndRegister(
  s: LogicalSession,
  geom: { cols: number; rows: number },
  opts: { onExit?: () => void } = {},
): IPty {
  const pty = resumeSession(s, geom)
  const codexState = codexActivityStateForSession(s)
  registerPty(s.sessionId, pty, {
    running: codexState === 'running',
    holdRunning: s.cli === 'codex' ? codexHoldRunning(codexState) : undefined,
    onExit: opts.onExit,
  })
  return pty
}
