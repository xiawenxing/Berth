import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import {
  getContextConfig, setContextConfig,
  DEFAULT_LOG_MAX_LINES, DEFAULT_LOG_KEEP, DEFAULT_GIT_ENABLED,
} from '../src/data/context-config'

describe('data/context-config', () => {
  it('falls back to defaults when unset', () => {
    const cfg = getContextConfig(openStore(':memory:'))
    expect(cfg.logMaxLines).toBe(DEFAULT_LOG_MAX_LINES)   // 40
    expect(cfg.logKeep).toBe(DEFAULT_LOG_KEEP)            // 15
    expect(cfg.protocolEnabled).toBe(true)
    expect(cfg.gitEnabled).toBe(DEFAULT_GIT_ENABLED)      // true
  })

  it('gitEnabled defaults to true and round-trips false', () => {
    const store = openStore(':memory:')
    expect(getContextConfig(store).gitEnabled).toBe(true)
    setContextConfig(store, { gitEnabled: false })
    expect(getContextConfig(store).gitEnabled).toBe(false)
  })

  it('round-trips overrides', () => {
    const store = openStore(':memory:')
    setContextConfig(store, { logMaxLines: 20, logKeep: 5, protocolEnabled: false })
    const cfg = getContextConfig(store)
    expect(cfg.logMaxLines).toBe(20)
    expect(cfg.logKeep).toBe(5)
    expect(cfg.protocolEnabled).toBe(false)
  })

  it('ignores invalid numbers and keeps keep < maxLines', () => {
    const store = openStore(':memory:')
    setContextConfig(store, { logMaxLines: 0, logKeep: 999 })
    const cfg = getContextConfig(store)
    expect(cfg.logMaxLines).toBe(DEFAULT_LOG_MAX_LINES)   // 0 invalid → default
    expect(cfg.logKeep).toBeLessThan(cfg.logMaxLines)     // clamped below maxLines
  })
})
