// Model B chat model — mirrors the backend src/agent/normalize/chat-model.ts. The backend reduces
// every CLI's wire stream into these ChatTurn[]; the frontend is a dumb renderer that just upserts.

export interface ToolResult {
  output: unknown
  ok: boolean
  truncated?: boolean
}

export type Block =
  | { kind: 'text'; text: string }
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

/** Apply one chat frame to the turn list: snapshot replaces, turn upserts by id (order preserved). */
export function applyChatFrame(turns: ChatTurn[], frame: ChatFrame): ChatTurn[] {
  if (frame.type === 'snapshot') return frame.turns
  if (frame.type === 'turn') {
    const i = turns.findIndex((t) => t.id === frame.turn.id)
    if (i < 0) return [...turns, frame.turn]
    const next = turns.slice()
    next[i] = frame.turn
    return next
  }
  return turns   // session / error don't change the turn list
}
