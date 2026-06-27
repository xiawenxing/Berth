/**
 * Path B detection: the agent declares its decided next status as a single sentinel line in its
 * final turn. We parse it from the transcript and (engine-side) apply it when the agent's own CLI
 * call (Path A) didn't already move the task. Pure — no IO.
 */
const SENTINEL_RE = /^[ \t>*-]*BERTH_TASK_STATUS:[ \t]+(\S+)[ \t]+(.+?)[ \t]*$/gm

/** Return the LAST sentinel whose taskId matches and whose status is in the vocab, else null. */
export function parseStatusSentinel(text: string, taskId: string, validStatuses: string[]): string | null {
  let found: string | null = null
  for (const m of text.matchAll(SENTINEL_RE)) {
    const id = m[1]
    const status = m[2].trim()
    if (id === taskId && validStatuses.includes(status)) found = status
  }
  return found
}

/**
 * Decision table run after the settle debounce.
 * - already off inProgress → Path A (the agent's CLI call) landed → no-op.
 * - still inProgress + a sentinel → apply it (Path B).
 * - still inProgress + no sentinel → leave it (no decision = no change).
 */
export function decideTaskStatusReconcile(args: {
  currentStatus: string | null
  inProgress: string | null
  sentinelStatus: string | null
}): string | null {
  const { currentStatus, inProgress, sentinelStatus } = args
  if (!inProgress || currentStatus !== inProgress) return null
  return sentinelStatus ?? null
}
