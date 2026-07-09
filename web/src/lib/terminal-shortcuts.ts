const SESSION_TERMINATE_CONTROLS = new Set([
  '\x03', // Ctrl+C / ETX
  '\x04', // Ctrl+D / EOT
  '\x1a', // Ctrl+Z / SUB
  '\x1c', // Ctrl+\ / FS
])

export function isSessionTerminateInput(data: string): boolean {
  return data.length === 1 && SESSION_TERMINATE_CONTROLS.has(data)
}
