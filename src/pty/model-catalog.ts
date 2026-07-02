import { execFile } from 'node:child_process'
import type { AgentCli } from '../types'
import { KNOWN_CLIS, MODEL_FLAG_CLIS } from '../data/agent-config'
import { firstUsableCandidate } from './binaries'

export interface AgentModelOption {
  id: string
  label: string
  description?: string
  contextWindow?: number
}

export interface AgentModelCatalog {
  cli: AgentCli
  ok: boolean
  source: 'cli' | 'help' | 'none'
  models: AgentModelOption[]
  error?: string
}

const MODEL_TIMEOUT_MS = 20_000
const MODEL_MAX_BUFFER = 24 * 1024 * 1024
const CACHE_TTL_MS = 5 * 60_000

const cache = new Map<AgentCli, { at: number; catalog: AgentModelCatalog }>()
const inFlight = new Map<AgentCli, Promise<AgentModelCatalog>>()

function execText(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout: MODEL_TIMEOUT_MS, maxBuffer: MODEL_MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) { reject(err); return }
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })
}

function uniqueOptions(items: AgentModelOption[]): AgentModelOption[] {
  const out: AgentModelOption[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const id = item.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...item, id, label: item.label.trim() || id })
  }
  return out
}

export function parseCodexModelsJson(text: string): AgentModelOption[] {
  const parsed = JSON.parse(text) as unknown
  const rows = Array.isArray((parsed as any)?.models) ? (parsed as any).models : []
  return uniqueOptions(rows
    .filter((m: any) => m && typeof m.slug === 'string' && m.visibility !== 'hidden')
    .map((m: any) => ({
      id: m.slug,
      label: typeof m.display_name === 'string' ? m.display_name : m.slug,
      description: typeof m.description === 'string' ? m.description : undefined,
    })))
}

export function parseCocoModelsJson(text: string): AgentModelOption[] {
  const parsed = JSON.parse(text) as unknown
  const rows = Array.isArray(parsed) ? parsed : []
  return uniqueOptions(rows
    .filter((m: any) => m && typeof m.name === 'string')
    .map((m: any) => ({
      id: m.name,
      label: typeof m.real_name === 'string' && m.real_name.trim() ? m.real_name : m.name,
      description: typeof m.description === 'string' ? m.description : undefined,
      contextWindow: typeof m.context_window === 'number' ? m.context_window : undefined,
    })))
}

export function parseClaudeModelAliasesFromHelp(text: string): AgentModelOption[] {
  const aliases = new Set<string>()
  const modelLine = text.match(/--model[\s\S]*?(?:model's full name|full name)/i)?.[0] ?? text
  for (const m of modelLine.matchAll(/'([^']+)'/g)) aliases.add(m[1])
  return uniqueOptions([...aliases].map(id => ({
    id,
    label: id,
    description: 'Claude Code --model alias from CLI help',
  })))
}

function emptyCatalog(cli: AgentCli, error: string): AgentModelCatalog {
  return { cli, ok: false, source: 'none', models: [], error }
}

async function detectOne(cli: AgentCli): Promise<AgentModelCatalog> {
  const bin = firstUsableCandidate(cli)
  if (!bin) return emptyCatalog(cli, 'binary not found')
  try {
    if (cli === 'codex') {
      const models = parseCodexModelsJson(await execText(bin, ['debug', 'models']))
      return { cli, ok: true, source: 'cli', models }
    }
    if (cli === 'coco') {
      const models = parseCocoModelsJson(await execText(bin, ['models', '--json']))
      return { cli, ok: true, source: 'cli', models }
    }
    const models = parseClaudeModelAliasesFromHelp(await execText(bin, ['--help']))
    return { cli, ok: models.length > 0, source: models.length > 0 ? 'help' : 'none', models, error: models.length ? undefined : 'no model list in help' }
  } catch (e: any) {
    return emptyCatalog(cli, String(e?.message ?? e))
  }
}

export async function getAgentModelCatalog(cli: AgentCli, force = false): Promise<AgentModelCatalog> {
  const now = Date.now()
  const cached = cache.get(cli)
  if (!force && cached && now - cached.at < CACHE_TTL_MS) return cached.catalog
  const existing = inFlight.get(cli)
  if (!force && existing) return existing
  const p = detectOne(cli).then(catalog => {
    cache.set(cli, { at: Date.now(), catalog })
    return catalog
  }).finally(() => {
    if (inFlight.get(cli) === p) inFlight.delete(cli)
  })
  inFlight.set(cli, p)
  return p
}

export async function getAgentModelCatalogs(force = false): Promise<AgentModelCatalog[]> {
  return Promise.all(KNOWN_CLIS
    .filter(cli => MODEL_FLAG_CLIS.includes(cli) || cli === 'coco')
    .map(cli => getAgentModelCatalog(cli, force)))
}

export function clearAgentModelCatalogCacheForTest(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('clearAgentModelCatalogCacheForTest is test-only')
  }
  cache.clear()
  inFlight.clear()
}
