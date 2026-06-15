import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import {
  getAgentConfig, setAgentConfig, resolveBerthAgent,
  DEFAULT_AGENTS, HEADLESS_CLIS, MODEL_FLAG_CLIS, DEFAULT_BERTH_MODEL,
} from '../src/data/agent-config'

describe('data/agent-config', () => {
  it('falls back to defaults when unset', () => {
    const store = openStore(':memory:')
    const cfg = getAgentConfig(store)
    expect(cfg.list).toEqual(DEFAULT_AGENTS)
    expect(cfg.berthAgentCli).toBe('claude')
    expect(cfg.berthAgentModel).toBe(DEFAULT_BERTH_MODEL)
    expect(cfg.headlessClis).toEqual(HEADLESS_CLIS)
    // every known cli is enabled by default
    expect(cfg.list.map(a => a.cli).sort()).toEqual(['claude', 'coco', 'codex'])
    expect(cfg.list.every(a => a.enabled)).toBe(true)
  })

  it('round-trips an agent list (enable/disable + model)', () => {
    const store = openStore(':memory:')
    setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: true, model: 'claude-opus-4-8' },
        { cli: 'codex', enabled: false, model: null },
        { cli: 'coco', enabled: true, model: null },
      ],
    })
    const cfg = getAgentConfig(store)
    expect(cfg.list.find(a => a.cli === 'claude')!.model).toBe('claude-opus-4-8')
    expect(cfg.list.find(a => a.cli === 'codex')!.enabled).toBe(false)
  })

  it('forces coco model to null (no --model flag)', () => {
    const store = openStore(':memory:')
    setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: true, model: null },
        { cli: 'codex', enabled: true, model: null },
        { cli: 'coco', enabled: true, model: 'whatever' },
      ],
    })
    expect(getAgentConfig(store).list.find(a => a.cli === 'coco')!.model).toBeNull()
    expect(MODEL_FLAG_CLIS).not.toContain('coco')
  })

  it('trims a model to null when blank', () => {
    const store = openStore(':memory:')
    setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: true, model: '   ' },
        { cli: 'codex', enabled: true, model: null },
        { cli: 'coco', enabled: true, model: null },
      ],
    })
    expect(getAgentConfig(store).list.find(a => a.cli === 'claude')!.model).toBeNull()
  })

  it('persists and resolves the berth management agent', () => {
    const store = openStore(':memory:')
    setAgentConfig(store, { berthAgentModel: 'claude-sonnet-4-6' })
    const r = resolveBerthAgent(store)
    expect(r).toEqual({ cli: 'claude', model: 'claude-sonnet-4-6' })
  })

  it('rejects an unknown cli', () => {
    const store = openStore(':memory:')
    expect(() => setAgentConfig(store, {
      list: [{ cli: 'gemini' as any, enabled: true, model: null }],
    })).toThrow(/unknown cli|must cover/i)
  })

  it('rejects a list that does not cover all known clis', () => {
    const store = openStore(':memory:')
    expect(() => setAgentConfig(store, {
      list: [{ cli: 'claude', enabled: true, model: null }],
    })).toThrow(/cover/i)
  })

  it('rejects duplicate clis', () => {
    const store = openStore(':memory:')
    expect(() => setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: true, model: null },
        { cli: 'claude', enabled: true, model: null },
        { cli: 'codex', enabled: true, model: null },
      ],
    })).toThrow(/duplicate/i)
  })

  it('rejects when no agent is enabled', () => {
    const store = openStore(':memory:')
    expect(() => setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: false, model: null },
        { cli: 'codex', enabled: false, model: null },
        { cli: 'coco', enabled: false, model: null },
      ],
    })).toThrow(/at least one/i)
  })

  it('allows codex as the berth agent (headless via codex exec)', () => {
    const store = openStore(':memory:')
    expect(HEADLESS_CLIS).toContain('codex')
    setAgentConfig(store, { berthAgentCli: 'codex', berthAgentModel: 'gpt-5' })
    expect(resolveBerthAgent(store)).toEqual({ cli: 'codex', model: 'gpt-5' })
  })

  it('allows an empty berth agent model (= the CLI\'s own default)', () => {
    const store = openStore(':memory:')
    setAgentConfig(store, { berthAgentCli: 'codex', berthAgentModel: '' })
    expect(resolveBerthAgent(store)).toEqual({ cli: 'codex', model: '' })
  })

  it('rejects a non-headless berth agent cli', () => {
    const store = openStore(':memory:')
    expect(() => setAgentConfig(store, { berthAgentCli: 'coco' })).toThrow(/headless/i)
  })

  it('rejects a disabled berth agent cli', () => {
    const store = openStore(':memory:')
    // claude is the only headless cli; disabling it then pointing berth at it must fail
    expect(() => setAgentConfig(store, {
      list: [
        { cli: 'claude', enabled: false, model: null },
        { cli: 'codex', enabled: true, model: null },
        { cli: 'coco', enabled: true, model: null },
      ],
      berthAgentCli: 'claude',
    })).toThrow(/enabled/i)
  })

  it('ignores invalid stored JSON and uses defaults', () => {
    const store = openStore(':memory:')
    store.setSetting('agentList', 'not json')
    store.setSetting('berthAgentCli', 'gemini')
    const cfg = getAgentConfig(store)
    expect(cfg.list).toEqual(DEFAULT_AGENTS)
    expect(cfg.berthAgentCli).toBe('claude')
  })
})
