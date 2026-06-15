import { describe, it, expect } from 'vitest'
import { computeCapabilities } from '../src/data/sync/registry'
import type { DataSourceAdapter } from '../src/data/sync/adapter'

const available = { kind: 'x', checkAvailable: async () => ({ available: true }) } as unknown as DataSourceAdapter
const unavailable = { kind: 'y', checkAvailable: async () => ({ available: false, reason: 'nope' }) } as unknown as DataSourceAdapter
const noCheck = { kind: 'z' } as unknown as DataSourceAdapter

describe('computeCapabilities', () => {
  it('reports each adapter availability, defaulting to available when no checkAvailable', async () => {
    const caps = await computeCapabilities({ x: available, y: unavailable, z: noCheck })
    expect(caps.x).toEqual({ available: true })
    expect(caps.y).toEqual({ available: false, reason: 'nope' })
    expect(caps.z).toEqual({ available: true })
  })
})
