// Model B chat model — mirrors the backend src/agent/normalize/chat-model.ts. The backend reduces
// every CLI's wire stream into these ChatTurn[]; the frontend is a dumb renderer that just upserts.

export interface ToolResult {
  output: unknown
  ok: boolean
  truncated?: boolean
}

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'reasoning'; text: string; opaque?: boolean }
  | { kind: 'tool_call'; id: string; name: string; input: unknown; status: 'running' | 'done' | 'error'; result?: ToolResult }

export interface TurnResult {
  durationMs?: number
  costUsd?: number
  usage?: { input?: number; output?: number; cacheRead?: number }
  isError?: boolean
  errorSubtype?: string
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  ts: number
  blocks: Block[]
  streaming?: boolean
  result?: TurnResult
}

export type ChatFrame =
  | { type: 'snapshot'; turns: ChatTurn[] }
  | { type: 'turn'; turn: ChatTurn }
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'error'; message: string }

export function makeUserTurn(
  id: string,
  text: string,
  ts = Math.floor(Date.now() / 1000),
  images: { src: string; alt?: string }[] = [],
): ChatTurn {
  const blocks: Block[] = [
    ...images.filter((image) => image.src).map((image) => ({ kind: 'image' as const, src: image.src, alt: image.alt })),
  ]
  if (text.trim()) blocks.push({ kind: 'text', text })
  return { id, role: 'user', ts, blocks }
}

/**
 * Is the chat busy (a turn in flight)? `streaming` alone leaves a feedback gap: the optimistic user
 * turn isn't streaming, and the assistant turn only becomes streaming at the agent's first frame —
 * seconds later while it thinks. `awaiting` covers that gap (submitted → first assistant frame).
 */
export function chatBusy(turns: ChatTurn[], awaiting: boolean): boolean {
  return awaiting || turns.some((t) => t.streaming)
}

export function blockHasVisibleContent(block: Block): boolean {
  if (block.kind === 'text') return block.text.trim().length > 0
  if (block.kind === 'reasoning') return block.opaque || block.text.trim().length > 0
  return true
}

export function turnHasVisibleContent(turn: ChatTurn): boolean {
  return turn.blocks.some(blockHasVisibleContent)
}

/**
 * Is the chat still waiting for something visible from the assistant? A stream can emit an empty
 * assistant shell first (`message_start` / `turn.started`), which is technically `streaming` but
 * visually blank. Keep the thinking indicator up until a text/reasoning/tool block is renderable.
 */
export function chatThinking(turns: ChatTurn[], awaiting: boolean): boolean {
  if (awaiting) return true
  return turns.some((t) => t.role === 'assistant' && !!t.streaming && !turnHasVisibleContent(t))
}

/** Does this frame end the `awaiting` gap? The agent's first assistant turn (it has begun
 *  responding) or an error (the turn failed to start). The echoed user turn / session frame do not. */
export function clearsAwaiting(frame: ChatFrame): boolean {
  return frame.type === 'error' || (frame.type === 'turn' && frame.turn.role === 'assistant')
}

/** Apply one chat frame to the turn list: snapshot replaces, turn upserts by id (order preserved). */
export function applyChatFrame(turns: ChatTurn[], frame: ChatFrame): ChatTurn[] {
  if (frame.type === 'snapshot') return frame.turns
  if (frame.type === 'turn') {
    const i = turns.findIndex((t) => t.id === frame.turn.id)
    if (i < 0) return [...turns, frame.turn]
    const next = turns.slice()
    next[i] = mergeTurnUpdate(turns[i], frame.turn)
    return next
  }
  if (frame.type === 'error') {
    return [
      ...turns,
      {
        id: `error_${Date.now()}_${turns.length}`,
        role: 'assistant',
        ts: Math.floor(Date.now() / 1000),
        blocks: [{ kind: 'text', text: frame.message }],
        result: { isError: true },
      },
    ]
  }
  return turns   // session doesn't change the turn list
}

function mergeTurnUpdate(prev: ChatTurn, incoming: ChatTurn): ChatTurn {
  if (prev.role !== 'user' || incoming.role !== 'user') return incoming
  const prevImages = prev.blocks.filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image')
  const incomingImages = incoming.blocks.some((b) => b.kind === 'image')
  if (!prevImages.length || incomingImages) return incoming
  const blocks = incoming.blocks
    .map((b): Block | null => {
      if (b.kind !== 'text') return b
      const text = stripAttachmentLabel(b.text)
      return text.trim() ? { ...b, text } : null
    })
    .filter((b): b is Block => !!b)
  return { ...incoming, blocks: [...prevImages, ...blocks] }
}

function stripAttachmentLabel(text: string): string {
  return text.replace(/\n\n已附加 \d+ 张图片\s*$/, '').replace(/^已附加 \d+ 张图片\s*$/, '')
}
