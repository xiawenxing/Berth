import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'

// ── Mock store-singleton so importing api.ts doesn't open a real SQLite DB ────
vi.mock('../src/server/store-singleton', () => ({
  getStore: vi.fn(() => ({})),
  getCache: vi.fn(() => []),
  refresh: vi.fn(),
  storeRoots: vi.fn(() => ({})),
}))

import { api } from '../src/server/api'

describe('GET /api/health', () => {
  it('returns 200 with berth identity fields', async () => {
    const app = express()
    app.use('/api', api)

    const srv: Server = app.listen(0)
    const port = (srv.address() as any).port
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`)
      expect(r.status).toBe(200)
      const body = await r.json() as Record<string, unknown>
      expect(body.berth).toBe(true)
      expect(typeof body.version === 'string' || body.version === null).toBe(true)
      expect(typeof body.berthHome).toBe('string')
      expect(typeof body.pid).toBe('number')
    } finally {
      await new Promise<void>(resolve => srv.close(() => resolve()))
    }
  })
})
