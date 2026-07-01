export const TITLE_MAX_CHARS = 200
export const TASK_CREATE_INPUT_MAX_CHARS = 12_000

export function compactTitle(raw: string, max = TITLE_MAX_CHARS): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}
