export interface ImagePlaceholder {
  marker?: string
  dataUrl: string
}

export type PromptPart<T extends ImagePlaceholder> =
  | { kind: 'text'; text: string }
  | { kind: 'image'; image: T; index: number }

export function splitTextByImagePlaceholders<T extends ImagePlaceholder>(text: string, images: T[]): PromptPart<T>[] {
  const source = text ?? ''
  const placed = images
    .map((image, index) => ({ image, index, marker: image.marker, pos: image.marker ? source.indexOf(image.marker) : -1 }))
    .filter((entry): entry is { image: T; index: number; marker: string; pos: number } => !!entry.marker && entry.pos >= 0)
    .sort((a, b) => a.pos - b.pos)
  const placedIndexes = new Set(placed.map((entry) => entry.index))
  const missing = images
    .map((image, index) => ({ image, index }))
    .filter((entry) => !placedIndexes.has(entry.index))

  const parts: PromptPart<T>[] = []
  const pushText = (value: string) => {
    if (value) parts.push({ kind: 'text', text: value })
  }

  for (const entry of missing) parts.push({ kind: 'image', image: entry.image, index: entry.index })

  let cursor = 0
  for (const entry of placed) {
    if (entry.pos < cursor) continue
    pushText(source.slice(cursor, entry.pos))
    parts.push({ kind: 'image', image: entry.image, index: entry.index })
    cursor = entry.pos + entry.marker.length
  }
  pushText(source.slice(cursor))

  return parts
}

export function stripImagePlaceholders<T extends ImagePlaceholder>(text: string, images: T[]): string {
  let next = text ?? ''
  for (const image of images) {
    if (!image.marker) continue
    next = next.split(image.marker).join('')
  }
  return next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
