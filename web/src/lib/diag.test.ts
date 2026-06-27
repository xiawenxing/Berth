import { describe, it, expect } from 'vitest'
import { capBuffer, type WebDiagEvent } from './diag'

function ev(i: number): WebDiagEvent {
  return { ts: i, category: 'c', event: String(i) }
}

describe('capBuffer', () => {
  it('keeps the newest events when over cap', () => {
    const buf = Array.from({ length: 5 }, (_, i) => ev(i))
    expect(capBuffer(buf, 3).map((e) => e.event)).toEqual(['2', '3', '4'])
  })
  it('returns the buffer untouched when under cap', () => {
    const buf = [ev(0), ev(1)]
    expect(capBuffer(buf, 3)).toBe(buf)
  })
})
