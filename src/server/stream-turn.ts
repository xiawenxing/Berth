import { currentDocStore } from '../data/docstore'

export interface TurnImage {
  name?: string
  dataUrl: string
  marker?: string
}

export interface PreparedStreamTurn {
  agentText: string
  displayText: string
}

interface SavedTurnImage {
  rel: string
  abs: string
  marker?: string
}

function imageCountLabel(count: number): string {
  return `已附加 ${count} 张图片`
}

/**
 * Model B has no terminal image-paste channel, so persisted image paths are folded into the text
 * sent to the CLI. Claude/Codex/Coco all understand local image paths in prompts.
 */
export function prepareStreamTurn(text: string, images?: TurnImage[]): PreparedStreamTurn {
  const rawText = text.trim()
  const saved: SavedTurnImage[] = (images ?? [])
    .filter((image): image is TurnImage => !!image && typeof image.dataUrl === 'string' && image.dataUrl.length > 0)
    .map((image) => {
      try {
        const saved = currentDocStore().saveAttachment(image.dataUrl, image.name || 'paste')
        return saved ? { ...saved, ...(image.marker ? { marker: image.marker } : {}) } : null
      }
      catch { return null }
    })
    .filter((image): image is SavedTurnImage => !!image)

  if (!saved.length) {
    return { agentText: rawText, displayText: rawText }
  }

  let agentText = rawText
  let displayText = rawText
  const remaining: typeof saved = []
  for (const image of saved) {
    if (image.marker && agentText.includes(image.marker)) {
      agentText = agentText.split(image.marker).join(image.abs)
      displayText = displayText || image.marker
    } else {
      remaining.push(image)
    }
  }

  if (!remaining.length) return { agentText, displayText }

  const paths = remaining.map((image, idx) => `${idx + 1}. ${image.abs}`).join('\n')
  const attachmentText = `Attached images:\n${paths}`
  return {
    agentText: agentText ? `${agentText}\n\n${attachmentText}` : attachmentText,
    displayText: displayText ? `${displayText}\n\n${imageCountLabel(remaining.length)}` : imageCountLabel(remaining.length),
  }
}
