import { currentDocStore } from '../data/docstore'

export interface TurnImage {
  name?: string
  dataUrl: string
}

export interface PreparedStreamTurn {
  agentText: string
  displayText: string
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
  const saved = (images ?? [])
    .filter((image): image is TurnImage => !!image && typeof image.dataUrl === 'string' && image.dataUrl.length > 0)
    .map((image) => {
      try { return currentDocStore().saveAttachment(image.dataUrl, image.name || 'paste') }
      catch { return null }
    })
    .filter((image): image is { rel: string; abs: string } => !!image)

  if (!saved.length) {
    return { agentText: rawText, displayText: rawText }
  }

  const paths = saved.map((image, idx) => `${idx + 1}. ${image.abs}`).join('\n')
  const attachmentText = `Attached images:\n${paths}`
  return {
    agentText: rawText ? `${rawText}\n\n${attachmentText}` : attachmentText,
    displayText: rawText ? `${rawText}\n\n${imageCountLabel(saved.length)}` : imageCountLabel(saved.length),
  }
}
