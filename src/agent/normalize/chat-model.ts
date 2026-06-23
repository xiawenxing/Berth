/**
 * Normalized chat model for Model B (stream-json chat rendering).
 *
 * The seam between (a) a live CLI wire stream and (b) on-disk jsonl replay, AND across CLIs: every
 * agent's output is reduced — on the BACKEND — into this one `ChatTurn[]` shape, so the frontend is a
 * dumb, agent-agnostic renderer. Adding codex/coco later = a new backend reducer, frontend untouched.
 *
 * Verified against claude 2.1.186 stream-json (see task smoke tests): the wire emits, per assistant
 * turn, `system/init` (re-emitted every turn) → `stream_event`(message_start / content_block_start /
 * content_block_delta / content_block_stop / message_delta / message_stop) → `assistant` (the full
 * assembled message, redundant with the deltas) → `result`. Tool results arrive on a later `user`
 * line. We drive rendering from the fine-grained `stream_event` deltas and fold tool_result into its
 * tool_call block so the UI shows one collapsed row per tool use.
 */

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
  /** stable key for in-place update (live) + list keying (replay) */
  id: string
  role: 'user' | 'assistant'
  /** epoch seconds */
  ts: number
  blocks: Block[]
  /** assistant turn still receiving deltas (live only) */
  streaming?: boolean
  /** assistant turn footer ("Worked for Ns / N tokens") */
  result?: TurnResult
}

/** WS frames the StreamJsonDriver sends to viewers (Model B). */
export type ChatFrame =
  | { type: 'snapshot'; turns: ChatTurn[] }     // replay on attach
  | { type: 'turn'; turn: ChatTurn }            // a turn was added or changed (upsert by id)
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'error'; message: string }

export type Clock = () => number   // epoch SECONDS; injectable for deterministic tests
