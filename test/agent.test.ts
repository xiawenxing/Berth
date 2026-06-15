import { describe, it, expect } from 'vitest'
import { runAgent, generateTitle } from '../src/agent/index'

describe('agent module', () => {
  it('exports runAgent and generateTitle as functions', () => {
    expect(typeof runAgent).toBe('function')
    expect(typeof generateTitle).toBe('function')
  })
})

describe.skipIf(!process.env.BERTH_LIVE)('agent live (BERTH_LIVE)', () => {
  it('generateTitle returns a non-empty string <= 100 chars', async () => {
    const title = await generateTitle('user: 帮我修复 login 页面的 toast 不显示的问题')
    console.log('generated title:', title)
    expect(typeof title).toBe('string')
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(100)
  }, 90000)

  // codex headless (codex exec -o <file>, stdin=/dev/null). Empty model → codex's own default.
  it('generateTitle works through the codex management agent', async () => {
    const title = await generateTitle('user: 帮我修复 login 页面的 toast 不显示的问题', { cli: 'codex', model: '' })
    console.log('codex title:', title)
    expect(typeof title).toBe('string')
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(100)
  }, 120000)
})
