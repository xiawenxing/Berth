// src/data/context-config.ts
// Context-management knobs in app_setting (JSON-free scalars). Mirrors task-config.ts.
type Store = { getSetting(key: string): string | null; setSetting(key: string, value: string): void }

export const DEFAULT_LOG_MAX_LINES = 40
export const DEFAULT_LOG_KEEP = 15
export const DEFAULT_DOC_MAX_CHARS = 24_000
export const DEFAULT_DOC_KEEP_CHARS = 12_000
export const DEFAULT_PROTOCOL_ENABLED = true
export const DEFAULT_GIT_ENABLED = true

const MAX_KEY = 'contextLogMaxLines'
const KEEP_KEY = 'contextLogKeep'
const DOC_MAX_KEY = 'contextDocMaxChars'
const DOC_KEEP_KEY = 'contextDocKeepChars'
const PROTO_KEY = 'contextProtocolEnabled'
const GIT_KEY = 'contextGitEnabled'

export interface ContextConfig {
  logMaxLines: number
  logKeep: number
  docMaxChars: number
  docKeepChars: number
  protocolEnabled: boolean
  gitEnabled: boolean
}

function readInt(store: Store, key: string, fallback: number): number {
  const raw = store.getSetting(key)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function getContextConfig(store: Store): ContextConfig {
  const logMaxLines = readInt(store, MAX_KEY, DEFAULT_LOG_MAX_LINES)
  let logKeep = readInt(store, KEEP_KEY, DEFAULT_LOG_KEEP)
  if (logKeep >= logMaxLines) logKeep = Math.max(1, logMaxLines - 1)   // keep must leave room to roll
  const docMaxChars = readInt(store, DOC_MAX_KEY, DEFAULT_DOC_MAX_CHARS)
  let docKeepChars = readInt(store, DOC_KEEP_KEY, DEFAULT_DOC_KEEP_CHARS)
  if (docKeepChars >= docMaxChars) docKeepChars = Math.max(1, Math.floor(docMaxChars * 0.6))
  const protocolEnabled = store.getSetting(PROTO_KEY) !== '0'           // default true; '0' disables
  const gitEnabled = store.getSetting(GIT_KEY) !== '0'                  // default true; '0' disables
  return { logMaxLines, logKeep, docMaxChars, docKeepChars, protocolEnabled, gitEnabled }
}

export function setContextConfig(store: Store, patch: Partial<ContextConfig>): ContextConfig {
  if (patch.logMaxLines !== undefined && Number.isInteger(patch.logMaxLines) && patch.logMaxLines > 0)
    store.setSetting(MAX_KEY, String(patch.logMaxLines))
  if (patch.logKeep !== undefined && Number.isInteger(patch.logKeep) && patch.logKeep > 0)
    store.setSetting(KEEP_KEY, String(patch.logKeep))
  if (patch.docMaxChars !== undefined && Number.isInteger(patch.docMaxChars) && patch.docMaxChars > 0)
    store.setSetting(DOC_MAX_KEY, String(patch.docMaxChars))
  if (patch.docKeepChars !== undefined && Number.isInteger(patch.docKeepChars) && patch.docKeepChars > 0)
    store.setSetting(DOC_KEEP_KEY, String(patch.docKeepChars))
  if (patch.protocolEnabled !== undefined)
    store.setSetting(PROTO_KEY, patch.protocolEnabled ? '1' : '0')
  if (patch.gitEnabled !== undefined)
    store.setSetting(GIT_KEY, patch.gitEnabled ? '1' : '0')
  return getContextConfig(store)
}
