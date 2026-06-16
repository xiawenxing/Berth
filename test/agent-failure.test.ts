import { describe, it, expect } from 'vitest'
import {
  classifyAgentFailure, looksLikeAuthBlock, InternalAgentBlocked, isInternalAgentBlocked, agentBlockHint,
} from '../src/agent/agent-failure'

describe('classifyAgentFailure', () => {
  it('returns timeout regardless of stderr when timedOut', () => {
    expect(classifyAgentFailure('claude', 'Invalid API key', true)).toBe('timeout')
    expect(classifyAgentFailure('codex', '', true)).toBe('timeout')
  })

  it('detects claude auth signatures', () => {
    for (const s of [
      'Error: Invalid API key',
      'Please run /login to authenticate',
      'run `claude login` first',
      'OAuth token refresh failed',
      'HTTP 401 Unauthorized',
      'authentication_error: not authenticated',
      'Your session has expired, please log in',
    ]) {
      expect(classifyAgentFailure('claude', s, false), s).toBe('auth')
    }
  })

  it('detects codex auth signatures', () => {
    for (const s of [
      'You are not logged in. Run `codex login`.',
      'login required',
      'request failed: 401 unauthorized',
      'credentials expired',
    ]) {
      expect(classifyAgentFailure('codex', s, false), s).toBe('auth')
    }
  })

  it('classifies unrecognized failures as other', () => {
    expect(classifyAgentFailure('claude', 'rate limit exceeded, try again', false)).toBe('other')
    expect(classifyAgentFailure('codex', 'model not found: gpt-x', false)).toBe('other')
    expect(classifyAgentFailure('claude', '', false)).toBe('other')
  })

  it('does not over-match billing/usage text as auth', () => {
    expect(looksLikeAuthBlock('claude', 'Your credit balance is too low')).toBe(false)
    expect(looksLikeAuthBlock('claude', 'usage limit reached for today')).toBe(false)
  })
})

describe('InternalAgentBlocked', () => {
  it('carries kind/cli/detail and is recognizable', () => {
    const e = new InternalAgentBlocked('auth', 'claude', 'Invalid API key')
    expect(e.kind).toBe('auth')
    expect(e.cli).toBe('claude')
    expect(e.detail).toBe('Invalid API key')
    expect(isInternalAgentBlocked(e)).toBe(true)
    expect(isInternalAgentBlocked(new Error('nope'))).toBe(false)
  })
})

describe('agentBlockHint', () => {
  it('gives an actionable login instruction per cli and locale', () => {
    expect(agentBlockHint('auth', 'claude', 'zh-CN')).toContain('claude login')
    expect(agentBlockHint('auth', 'codex', 'zh-CN')).toContain('codex login')
    expect(agentBlockHint('auth', 'claude', 'en')).toContain('claude login')
    expect(agentBlockHint('timeout', 'codex', 'en')).toContain('codex login')
  })
})
