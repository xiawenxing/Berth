import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server/index'

// Spin up createApp() on an ephemeral port and return its base URL.
async function listen(app: ReturnType<typeof createApp>): Promise<{ url: string; server: Server }> {
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  return { url: `http://127.0.0.1:${port}`, server }
}

describe('2.0 SPA root routing', () => {
  let server: Server | undefined
  afterEach(() => { server?.close(); server = undefined })

  it('redirects / to /app/ when web/dist is present', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'berth-webdist-'))
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>2.0</title>')
    try {
      const got = await listen(createApp(webDist)); server = got.server
      const res = await fetch(`${got.url}/`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/app/')
    } finally {
      rmSync(webDist, { recursive: true, force: true })
    }
  })

  it('serves the SPA index.html at /app', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'berth-webdist-'))
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>SPA</title>')
    try {
      const got = await listen(createApp(webDist)); server = got.server
      const res = await fetch(`${got.url}/app`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('SPA')
    } finally {
      rmSync(webDist, { recursive: true, force: true })
    }
  })

  it('falls back to serving the 1.0 public/ UI at / when web/dist is absent', async () => {
    const got = await listen(createApp(null)); server = got.server
    const res = await fetch(`${got.url}/`, { redirect: 'manual' })
    // No redirect to /app/ — the legacy static UI is served directly (200).
    expect(res.status).toBe(200)
  })
})
