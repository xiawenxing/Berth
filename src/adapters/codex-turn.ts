import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

export type CodexTurnState = 'running' | 'complete' | 'unknown'

const TAIL_BYTES = 8 * 1024 * 1024

/**
 * Read Codex's latest turn lifecycle from a rollout JSONL file.
 *
 * Codex can be silent for long stretches while a turn is still active. PTY-output idleness is
 * therefore not enough to decide that a turn has settled; these lifecycle records are the durable
 * signal. We only need the latest lifecycle event, so a bounded tail read keeps huge historical
 * rollouts cheap enough for the live status guard.
 */
export function latestCodexTurnState(path: string): CodexTurnState {
  let text: string
  try { text = readTail(path, TAIL_BYTES) } catch { return 'unknown' }

  let state: CodexTurnState = 'unknown'
  let activeTurnId: string | null = null
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    let o: any
    try { o = JSON.parse(raw) } catch { continue }
    if (o?.type !== 'event_msg') continue
    const p = o.payload
    if (p?.type === 'task_started') {
      state = 'running'
      activeTurnId = typeof p.turn_id === 'string' ? p.turn_id : null
    } else if (p?.type === 'task_complete' || p?.type === 'turn_aborted') {
      const doneTurnId = typeof p.turn_id === 'string' ? p.turn_id : null
      if (!activeTurnId || !doneTurnId || activeTurnId === doneTurnId) {
        state = 'complete'
        activeTurnId = null
      }
    }
  }
  return state
}

function readTail(path: string, bytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const len = size - start
    if (len <= 0) return ''
    const buf = Buffer.alloc(len)
    const n = readSync(fd, buf, 0, len, start)
    return buf.toString('utf8', 0, n)
  } finally { closeSync(fd) }
}
