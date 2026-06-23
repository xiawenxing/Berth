// Builds the right Model B SessionDriver per CLI: claude uses the persistent StreamJsonDriver (one
// long-lived process, stdin turn injection); codex/coco use the PerTurnStreamDriver (single-turn-then-
// exit → a fresh process per turn). coco's wire schema is claude-compatible so it reuses ClaudeReducer.
import type { SessionDriver } from './session-driver'
import { StreamJsonDriver } from './stream-json-driver'
import { PerTurnStreamDriver } from './per-turn-stream-driver'
import { ClaudeReducer } from '../agent/normalize/claude-reducer'
import { CodexReducer } from '../agent/normalize/codex-reducer'
import type { ChatReducer } from '../agent/normalize/chat-model'
import { launchFreshStream, resumeSessionStream, spawnPerTurn } from '../pty/launch'
import type { AgentCli, LogicalSession } from '../types'

const nowSec = () => Math.floor(Date.now() / 1000)
const newReducer = (cli: AgentCli): ChatReducer => (cli === 'codex' ? new CodexReducer(nowSec) : new ClaudeReducer(nowSec))

export interface FreshStreamOpts { cwd: string; sessionId?: string; injectFile?: string; model?: string; addDirs?: string[]; initialPrompt?: string }

/** A fresh Model B launch driver. claude = persistent; codex/coco = per-turn. */
export function makeFreshStreamDriver(cli: AgentCli, o: FreshStreamOpts): SessionDriver {
  if (cli === 'claude') {
    return new StreamJsonDriver(
      launchFreshStream({ cwd: o.cwd, sessionId: o.sessionId, injectFile: o.injectFile, model: o.model, addDirs: o.addDirs }),
      { initialPrompt: o.initialPrompt },
    )
  }
  const spawnTurn = (prompt: string, resumeId: string | null) => spawnPerTurn(cli, { cwd: o.cwd, sessionId: o.sessionId, model: o.model, prompt, resumeId })
  return new PerTurnStreamDriver(newReducer(cli), spawnTurn, { initialPrompt: o.initialPrompt })
}

/** A resume Model B driver. claude resumes one persistent process; codex/coco resume per-turn (the
 *  resumeId seed continues the existing session from the first typed turn). */
export function makeResumeStreamDriver(s: LogicalSession): SessionDriver {
  const cli = s.resume!.cli
  if (cli === 'claude') return new StreamJsonDriver(resumeSessionStream(s))
  const spawnTurn = (prompt: string, resumeId: string | null) => spawnPerTurn(cli, { cwd: s.cwd ?? '', prompt, resumeId })
  return new PerTurnStreamDriver(newReducer(cli), spawnTurn, { resumeId: s.resume!.id })
}
