// src/data/context-protocol.ts
// Resolve the effective context protocol (AGENTS.md): a seeded global default + an optional
// per-project override. Phase-1 inline rules are constant (from i18n); the file carries full detail.
import { existsSync } from 'node:fs'
import type { DocStore } from './docstore'
import { contextStrings, type Locale } from '../i18n'

export const GLOBAL_PROTOCOL_REF = 'AGENTS.md'
export function projectProtocolRef(name: string): string { return `projects/${name}/AGENTS.md` }

export interface EffectiveProtocol {
  compactRules: string[]
  protocolPath: string | null   // abs path the agent can Read for full rules/overrides
}

/** Write the built-in default global AGENTS.md once. Never clobbers an existing (possibly edited) file. */
export function seedDefaultProtocol(docStore: DocStore, locale: Locale): void {
  const abs = docStore.resolveDocPath(GLOBAL_PROTOCOL_REF)
  if (!abs || existsSync(abs)) return
  docStore.writeDoc(abs, contextStrings(locale).protocolDoc)
}

/** Effective protocol for a launch: per-project override path if present, else the global (seeded) one. */
export function resolveProtocol(docStore: DocStore, locale: Locale, projectName?: string | null): EffectiveProtocol {
  const compactRules = contextStrings(locale).compactRules
  if (projectName) {
    const projAbs = docStore.resolveDocPath(projectProtocolRef(projectName))
    if (projAbs && existsSync(projAbs)) return { compactRules, protocolPath: projAbs }
  }
  const globalAbs = docStore.resolveDocPath(GLOBAL_PROTOCOL_REF)
  return { compactRules, protocolPath: globalAbs }
}
