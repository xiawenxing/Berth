/** Validated SessionStart callback: the real codex session id + the cwd codex recorded. The launch
 *  token is NOT in the envelope — it comes from the callback FILE NAME (the hook writes the envelope
 *  to <token>.json). */
export interface LaunchCallback {
  sessionId: string
  cwd: string
}

/**
 * Parse codex's SessionStart hook envelope (the raw JSON the hook received on stdin and dumped to the
 * callback file). Returns null for anything malformed or not a SessionStart event — logging never
 * throws into the bind path.
 */
export function parseLaunchCallback(raw: string): LaunchCallback | null {
  let obj: any
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || obj.hook_event_name !== 'SessionStart') return null
  const sessionId = obj.session_id
  const cwd = obj.cwd
  if (typeof sessionId !== 'string' || !sessionId) return null
  if (typeof cwd !== 'string' || !cwd) return null
  return { sessionId, cwd }
}
