import { describe, it, expect } from 'vitest'
import { WriteQueue } from '../src/bitable/writeQueue'

describe('WriteQueue', () => {
  it('serializes writes with >=spacing and dedups by idempotency key', async () => {
    const calls: { key: string; t: number }[] = []
    const q = new WriteQueue({ spacingMs: 20, run: async (job) => { calls.push({ key: job.key, t: Date.now() }) } })
    q.enqueue({ key: 'a', payload: 1 }); q.enqueue({ key: 'a', payload: 1 })
    q.enqueue({ key: 'b', payload: 2 })
    await q.drain()
    expect(calls.map(c => c.key)).toEqual(['a', 'b'])
    expect(calls[1].t - calls[0].t).toBeGreaterThanOrEqual(18)
  })
  it('a failed job surfaces and does not silently vanish', async () => {
    const q = new WriteQueue({ spacingMs: 1, run: async () => { throw new Error('1254291') } })
    const errs: unknown[] = []; q.onError = (e) => errs.push(e)
    q.enqueue({ key: 'x', payload: 0 }); await q.drain()
    expect(errs).toHaveLength(1)
  })
})
