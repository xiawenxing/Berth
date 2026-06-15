import { describe, it, expect } from 'vitest'
import { enqueueWrite } from '../src/bitable/queue-singleton'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('enqueueWrite (serial bitable writer)', () => {
  it('resolves a single write with its result', async () => {
    await expect(enqueueWrite('single', async () => 42)).resolves.toBe(42)
  })

  it('coalesces concurrent same-key calls to ONE exec and does not hang (the WriteQueue dedup bug)', async () => {
    let calls = 0
    const exec = async () => { calls++; await delay(5); return 'R' }
    const [a, b, c] = await Promise.all([
      enqueueWrite('dup', exec),
      enqueueWrite('dup', exec),
      enqueueWrite('dup', exec),
    ])
    expect([a, b, c]).toEqual(['R', 'R', 'R'])
    expect(calls).toBe(1) // coalesced — the 2nd/3rd awaiters must NOT hang and must NOT double-write
  })

  it('frees the key after settle so the same logical write can run again later', async () => {
    const first = await enqueueWrite('reuse', async () => 'first')
    const second = await enqueueWrite('reuse', async () => 'second')
    expect(first).toBe('first')
    expect(second).toBe('second') // not dropped/coalesced into the prior settled write
  })

  it('propagates rejection and frees the key for retry', async () => {
    await expect(enqueueWrite('boom', async () => { throw new Error('nope') })).rejects.toThrow('nope')
    await expect(enqueueWrite('boom', async () => 'ok')).resolves.toBe('ok')
  })
})
