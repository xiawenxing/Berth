// src/agent/agent-failure.ts
// Pure classification of a headless management-agent failure into an actionable kind, plus the typed
// error the runner throws and a localized hint the UI can show. No I/O — fully unit-testable.
//
// The auth signature tables are BEST-EFFORT and must be confirmed against real claude `-p` / codex
// `exec` output (see the design's open items). They are deliberately conservative substring/word
// patterns to avoid mislabeling unrelated failures as auth.
import type { AgentCli } from '../types'
import type { Locale } from '../i18n'

export type AgentBlockKind = 'auth' | 'timeout' | 'other'

// Patterns common to any CLI's unauthenticated/expired-credential output.
const COMMON_AUTH: RegExp[] = [
  /unauthorized/i,
  /not authenticated/i,
  /authentication[_\s-]?error/i,
  /\b401\b/,
  /(?:token|session|credential)s?\s+(?:has\s+|have\s+)?expired/i,
  /please\s+(?:re-?)?log\s?in/i,
]
// Per-CLI extras (login command names, provider-specific markers).
const CLI_AUTH: Partial<Record<AgentCli, RegExp[]>> = {
  claude: [/invalid api key/i, /run\s+\/login/i, /\bclaude\s+login\b/i, /\boauth\b/i],
  codex: [/\bcodex\s+login\b/i, /not\s+logged\s+in/i, /login\s+required/i],
}

/** Does this stderr/stdout text look like an auth/login block for `cli`? */
export function looksLikeAuthBlock(cli: AgentCli, text: string): boolean {
  if (!text) return false
  const patterns = [...COMMON_AUTH, ...(CLI_AUTH[cli] ?? [])]
  return patterns.some(re => re.test(text))
}

/** Classify a failure. Timeout wins (we may have no stderr); else auth by signature; else other. */
export function classifyAgentFailure(cli: AgentCli, stderr: string, timedOut: boolean): AgentBlockKind {
  if (timedOut) return 'timeout'
  if (looksLikeAuthBlock(cli, stderr)) return 'auth'
  return 'other'
}

/** Typed error thrown by the headless runner so callers/endpoints can react to the kind. */
export class InternalAgentBlocked extends Error {
  constructor(public readonly kind: AgentBlockKind, public readonly cli: AgentCli, public readonly detail: string = '') {
    super(`internal agent (${cli}) blocked: ${kind}${detail ? ` — ${detail}` : ''}`)
    this.name = 'InternalAgentBlocked'
  }
}

export function isInternalAgentBlocked(e: unknown): e is InternalAgentBlocked {
  return e instanceof InternalAgentBlocked
}

/** A short, actionable hint for the UI. Locale-aware; falls back to English. */
export function agentBlockHint(kind: AgentBlockKind, cli: AgentCli, locale: Locale = 'en'): string {
  const login = cli === 'codex' ? 'codex login' : 'claude login'
  if (locale === 'zh-CN') {
    switch (kind) {
      case 'auth': return `Berth 内部 agent（${cli}）需要重新登录。请在终端运行 \`${login}\`，完成后重试。`
      case 'timeout': return `Berth 内部 agent（${cli}）未在限定时间内响应。可能需要重新登录（\`${login}\`）或稍后重试。`
      default: return `Berth 内部 agent（${cli}）执行失败。${kind}`
    }
  }
  switch (kind) {
    case 'auth': return `Berth's internal agent (${cli}) needs to re-authenticate. Run \`${login}\` in a terminal, then retry.`
    case 'timeout': return `Berth's internal agent (${cli}) did not respond in time. It may need re-auth (\`${login}\`) or a retry.`
    default: return `Berth's internal agent (${cli}) failed.`
  }
}
