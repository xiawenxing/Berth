import { describe, it, expect, vi } from 'vitest'
import type { Logger } from 'vite'
import { isBenignProxyError, quietProxyLogger } from './dev-proxy'

describe('isBenignProxyError', () => {
  it('treats EPIPE and ECONNRESET as benign socket churn', () => {
    expect(isBenignProxyError({ code: 'EPIPE' })).toBe(true)
    expect(isBenignProxyError({ code: 'ECONNRESET' })).toBe(true)
  })

  it('keeps real failures and non-errno values', () => {
    expect(isBenignProxyError({ code: 'ECONNREFUSED' })).toBe(false)
    expect(isBenignProxyError(new Error('boom'))).toBe(false)
    expect(isBenignProxyError(undefined)).toBe(false)
    expect(isBenignProxyError(null)).toBe(false)
  })
})

function makeLogger() {
  const error = vi.fn()
  const base = {
    error,
    info: vi.fn(),
    warn: vi.fn(),
    warnOnce: vi.fn(),
    clearScreen: vi.fn(),
    hasErrorLogged: vi.fn(),
    hasWarned: false,
  } as unknown as Logger
  return { base, error }
}

describe('quietProxyLogger', () => {
  it('drops benign ws proxy churn (EPIPE / ECONNRESET)', () => {
    const { base, error } = makeLogger()
    const logger = quietProxyLogger(base)
    logger.error('ws proxy socket error', { error: { code: 'EPIPE' } as NodeJS.ErrnoException })
    logger.error('ws proxy socket error', { error: { code: 'ECONNRESET' } as NodeJS.ErrnoException })
    expect(error).not.toHaveBeenCalled()
  })

  it('passes through real errors and unrelated logs', () => {
    const { base, error } = makeLogger()
    const logger = quietProxyLogger(base)
    logger.error('build failed')
    logger.error('backend down', { error: { code: 'ECONNREFUSED' } as NodeJS.ErrnoException })
    expect(error).toHaveBeenCalledTimes(2)
  })
})
