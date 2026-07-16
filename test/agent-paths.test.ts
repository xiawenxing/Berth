import { describe, expect, it } from 'vitest'
import { agentStoreRoots, codexHome, cocoStoreRoot } from '../src/agent-paths'

describe('agent storage paths', () => {
  it('uses CODEX_HOME consistently for Codex storage', () => {
    expect(codexHome({ CODEX_HOME: '/portable/codex' }, '/Users/a')).toBe('/portable/codex')
    expect(agentStoreRoots({ CODEX_HOME: '/portable/codex' }, '/Users/a', 'darwin').codexRoot).toBe('/portable/codex/')
  })

  it('allows explicit Berth overrides without changing BERTH_HOME', () => {
    const roots = agentStoreRoots({ BERTH_CLAUDE_ROOT: '/data/claude', BERTH_CODEX_ROOT: '/data/codex', BERTH_COCO_ROOT: '/data/coco' }, '/Users/a', 'darwin')
    expect(roots).toEqual({ claudeRoot: '/data/claude/', codexRoot: '/data/codex/', cocoRoot: '/data/coco/' })
  })

  it('uses the platform cache convention for Coco when no override exists', () => {
    expect(cocoStoreRoot({}, '/Users/a', 'darwin')).toBe('/Users/a/Library/Caches/coco')
    expect(cocoStoreRoot({}, '/home/a', 'linux')).toBe('/home/a/.cache/coco')
    expect(cocoStoreRoot({ XDG_CACHE_HOME: '/run/cache' }, '/home/a', 'linux')).toBe('/run/cache/coco')
  })
})
