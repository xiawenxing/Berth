import { describe, it, expect } from 'vitest'
import type { AgentCli } from '../src/types'
describe('smoke', () => {
  it('types load', () => { const c: AgentCli = 'codex'; expect(c).toBe('codex') })
})
