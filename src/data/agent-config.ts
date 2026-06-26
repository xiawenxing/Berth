// User-configurable agent (CLI) options + the internal "berth management agent" selection.
// Stored in app_setting (mirrors task-config.ts): unset/invalid → defaults, so existing stores keep
// working. Two concerns, deliberately decoupled:
//   1. launch agents  — which of the known CLIs appear in the session-launch picker, in what order,
//      each with an optional default model passed on a FRESH launch.
//   2. berth agent    — which CLI + model the headless management agent (titles/triage) uses.
//      Its model is separate from any per-CLI launch model (titles want cheap/fast; a launched
//      working session may want a heavy model).

import type { AgentCli } from '../types'

type Store = { getSetting(key: string): string | null; setSetting(key: string, value: string): void }

/** Every CLI Berth knows how to launch. The single source of truth is types.ts `AgentCli`. */
export const KNOWN_CLIS: AgentCli[] = ['claude', 'codex', 'coco']

/** CLIs whose fresh launch accepts a `--model` flag (verified 2026-06-15). coco has no model flag. */
export const MODEL_FLAG_CLIS: AgentCli[] = ['claude', 'codex']

/** CLIs that can serve as the headless management agent (a clean one-shot reply).
 *  - claude: `claude -p` prints a reply-only stdout.
 *  - codex: `codex exec -o <file>` writes JUST the final reply to a file (stdout has banner/log
 *    noise, so we read the file instead — see agent/index.ts).
 *  coco has no headless one-shot mode, so it's excluded. */
export const HEADLESS_CLIS: AgentCli[] = ['claude', 'codex']

export const DEFAULT_BERTH_CLI: AgentCli = 'claude'
export const DEFAULT_BERTH_MODEL = 'claude-haiku-4-5'

export interface AgentEntry {
  cli: AgentCli
  enabled: boolean
  model: string | null   // default model for a FRESH launch; null = the CLI's own default
  safeMode: boolean       // ON → omit the approval-bypass flag on interactive (Model A) launch. Default false.
}

export const DEFAULT_AGENTS: AgentEntry[] = KNOWN_CLIS.map(cli => ({ cli, enabled: true, model: null, safeMode: false }))

export interface AgentConfig {
  list: AgentEntry[]
  berthAgentCli: AgentCli
  berthAgentModel: string
  headlessClis: AgentCli[]   // surfaced to the UI so it can filter the berth-agent picker
}

const LIST_KEY = 'agentList'
const BERTH_CLI_KEY = 'berthAgentCli'
const BERTH_MODEL_KEY = 'berthAgentModel'

function isCli(v: unknown): v is AgentCli {
  return typeof v === 'string' && (KNOWN_CLIS as string[]).includes(v)
}

/** A model is either null or a non-empty trimmed string. coco never carries a model (no flag). */
function normModel(cli: AgentCli, model: unknown): string | null {
  if (!MODEL_FLAG_CLIS.includes(cli)) return null
  if (typeof model !== 'string') return null
  const t = model.trim()
  return t ? t : null
}

/** Read + normalize the stored list. Any malformed entry falls back to the full defaults. */
function readList(store: Store): AgentEntry[] {
  const raw = store.getSetting(LIST_KEY)
  if (!raw) return DEFAULT_AGENTS
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_AGENTS
    const out: AgentEntry[] = []
    const seen = new Set<string>()
    for (const e of parsed) {
      if (!e || !isCli(e.cli) || seen.has(e.cli)) return DEFAULT_AGENTS
      seen.add(e.cli)
      out.push({ cli: e.cli, enabled: e.enabled !== false, model: normModel(e.cli, e.model), safeMode: e.safeMode === true })
    }
    // must cover exactly the known clis
    if (seen.size !== KNOWN_CLIS.length) return DEFAULT_AGENTS
    if (!out.some(a => a.enabled)) return DEFAULT_AGENTS
    return out
  } catch {
    return DEFAULT_AGENTS
  }
}

export function getAgentConfig(store: Store): AgentConfig {
  const list = readList(store)
  const storedCli = store.getSetting(BERTH_CLI_KEY)
  const enabledHeadless = (c: AgentCli) =>
    HEADLESS_CLIS.includes(c) && list.find(a => a.cli === c)?.enabled
  let berthAgentCli: AgentCli =
    isCli(storedCli) && enabledHeadless(storedCli) ? storedCli : DEFAULT_BERTH_CLI
  // safety: if even the default isn't a valid choice, pick the first enabled headless cli
  if (!enabledHeadless(berthAgentCli)) {
    berthAgentCli = (HEADLESS_CLIS.find(c => list.find(a => a.cli === c)?.enabled) ?? DEFAULT_BERTH_CLI)
  }
  // null = never configured → preserve the claude+haiku default. An explicit '' means "the CLI's
  // own default" (used when the berth agent is a non-claude CLI without a pinned model).
  const storedModel = store.getSetting(BERTH_MODEL_KEY)
  const berthAgentModel = storedModel === null ? DEFAULT_BERTH_MODEL : storedModel
  return { list, berthAgentCli, berthAgentModel, headlessClis: HEADLESS_CLIS }
}

export function resolveBerthAgent(store: Store): { cli: AgentCli; model: string } {
  const cfg = getAgentConfig(store)
  return { cli: cfg.berthAgentCli, model: cfg.berthAgentModel }
}

export interface AgentConfigPatch {
  list?: unknown
  berthAgentCli?: unknown
  berthAgentModel?: unknown
}

function cleanList(input: unknown): AgentEntry[] {
  if (!Array.isArray(input)) throw new Error('agent list must be an array')
  const out: AgentEntry[] = []
  const seen = new Set<string>()
  for (const e of input) {
    if (!e || !isCli((e as any).cli)) throw new Error('unknown cli in agent list')
    const cli = (e as any).cli as AgentCli
    if (seen.has(cli)) throw new Error(`duplicate cli "${cli}" in agent list`)
    seen.add(cli)
    out.push({ cli, enabled: (e as any).enabled !== false, model: normModel(cli, (e as any).model), safeMode: (e as any).safeMode === true })
  }
  for (const c of KNOWN_CLIS) if (!seen.has(c)) throw new Error(`agent list must cover all clis (missing "${c}")`)
  if (!out.some(a => a.enabled)) throw new Error('at least one agent must be enabled')
  return out
}

/** Validate + persist the provided fields (each optional). Throws on invalid input; returns the
 *  resulting config. The berth cli must be headless-capable AND enabled in the (new or existing) list. */
export function setAgentConfig(store: Store, patch: AgentConfigPatch): AgentConfig {
  // Validate everything first (against the resulting list) so an invalid patch never half-persists.
  const newList = patch.list !== undefined ? cleanList(patch.list) : getAgentConfig(store).list

  let newBerthCli: AgentCli | undefined
  if (patch.berthAgentCli !== undefined) {
    const c = patch.berthAgentCli
    if (!isCli(c)) throw new Error('unknown berth agent cli')
    if (!HEADLESS_CLIS.includes(c)) throw new Error(`"${c}" cannot be the berth agent (no headless support)`)
    if (!newList.find(a => a.cli === c)?.enabled) throw new Error(`berth agent cli "${c}" must be enabled`)
    newBerthCli = c
  }

  let newBerthModel: string | undefined
  if (patch.berthAgentModel !== undefined) {
    if (typeof patch.berthAgentModel !== 'string') throw new Error('berth agent model must be a string')
    newBerthModel = patch.berthAgentModel.trim()   // '' allowed = the CLI's own default
  }

  if (patch.list !== undefined) store.setSetting(LIST_KEY, JSON.stringify(newList))
  if (newBerthCli !== undefined) store.setSetting(BERTH_CLI_KEY, newBerthCli)
  if (newBerthModel !== undefined) store.setSetting(BERTH_MODEL_KEY, newBerthModel)
  return getAgentConfig(store)
}
