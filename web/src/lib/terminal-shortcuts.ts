const SESSION_TERMINATE_CONTROLS = new Set([
  '\x04', // Ctrl+D / EOT
  '\x1a', // Ctrl+Z / SUB
  '\x1c', // Ctrl+\ / FS
])

const SESSION_TERMINATE_KEYS = new Set(['d', 'z', '\\'])

export function isSessionTerminateInput(data: string): boolean {
  return data.length === 1 && SESSION_TERMINATE_CONTROLS.has(data)
}

/**
 * The stream/chat renderer has no xterm `onData` control bytes. Keep its keyboard semantics in
 * lockstep with the TUI renderer: Ctrl+C stays with the CLI to interrupt its current action;
 * Ctrl+D, Ctrl+Z and Ctrl+\\ explicitly end the whole Berth-owned session.
 */
export function isSessionTerminateKeyboardEvent(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'key'>): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && SESSION_TERMINATE_KEYS.has(event.key.toLowerCase())
}
