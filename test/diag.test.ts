import { describe, it, expect } from 'vitest'
import { normalizeEvent, redactFields, pushRing, cheapHash, type DiagEvent } from '../src/server/diag'

describe('redactFields', () => {
  it('digests sensitive text instead of storing it', () => {
    const out = redactFields({ prompt: 'fix the login bug', cwd: '/repo' })
    expect(out.prompt).toBeUndefined()
    expect(out.promptLen).toBe('fix the login bug'.length)
    expect(typeof out.promptHash).toBe('string')
    expect(out.cwd).toBe('/repo')   // non-sensitive passthrough
  })

  it('does not emit a hash for empty sensitive strings', () => {
    const out = redactFields({ text: '' })
    expect(out.textLen).toBe(0)
    expect(out.textHash).toBeUndefined()
  })

  it('drops bulky image payloads, keeping only a count', () => {
    const out = redactFields({ images: [{ dataUrl: 'AAA' }, { dataUrl: 'BBB' }], dataUrl: 'huge' })
    expect(out.imagesCount).toBe(2)
    expect(out.images).toBeUndefined()
    expect(out.dataUrl).toBeUndefined()
  })

  it('same prompt hashes the same, different prompts differ', () => {
    expect(cheapHash('abc')).toBe(cheapHash('abc'))
    expect(cheapHash('abc')).not.toBe(cheapHash('abd'))
  })
})

describe('normalizeEvent', () => {
  it('fills ts/source/level defaults and lifts correlation keys', () => {
    const ev = normalizeEvent({ category: 'launch', event: 'fresh_start', launchToken: 'tok1', cli: 'claude' }, 'server', 1000)
    expect(ev).toMatchObject({ ts: 1000, source: 'server', category: 'launch', event: 'fresh_start', level: 'info', launchToken: 'tok1', cli: 'claude' })
  })

  it('honors an explicit ts (web events carry their own timestamp)', () => {
    const ev = normalizeEvent({ ts: 42, category: 'ui', event: 'drawer_close' }, 'web', 9999)
    expect(ev.ts).toBe(42)
    expect(ev.source).toBe('web')
  })

  it('redacts extra fields and preserves level=error', () => {
    const ev = normalizeEvent({ category: 'launch', event: 'error', level: 'error', prompt: 'secret', message: 'boom' }, 'server', 1)
    expect(ev.level).toBe('error')
    expect((ev as any).prompt).toBeUndefined()
    expect((ev as any).promptLen).toBe(6)
    expect((ev as any).message).toBe('boom')
  })

  it('omits correlation keys that are absent', () => {
    const ev = normalizeEvent({ category: 'pty', event: 'exit' }, 'server', 1)
    expect('launchToken' in ev).toBe(false)
    expect('sessionId' in ev).toBe(false)
  })
})

describe('pushRing', () => {
  it('evicts oldest beyond the cap', () => {
    const ring: DiagEvent[] = []
    for (let i = 0; i < 5; i++) pushRing(ring, normalizeEvent({ category: 'c', event: String(i) }, 'server', i), 3)
    expect(ring.map((e) => e.event)).toEqual(['2', '3', '4'])
  })
})
