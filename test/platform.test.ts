import { describe, it, expect } from 'vitest'
import { commandExists } from '../src/platform'

describe('commandExists', () => {
  it('resolves true for a binary on PATH (node)', async () => {
    expect(await commandExists('node')).toBe(true)
  })

  it('resolves false for a command that is not on PATH', async () => {
    expect(await commandExists('berth-definitely-not-a-real-command-xyz')).toBe(false)
  })
})
