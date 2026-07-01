import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeServerFile } from '../src/server-discovery'
import { __resolveBaseUrl } from '../src/cli-data'

const ENV = ['BERTH_PORT','BERTH_HOST','PORT','HOST'] as const
let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(),'berth-url-')); process.env.BERTH_HOME = home; ENV.forEach(k => delete process.env[k]) })
afterEach(() => { delete process.env.BERTH_HOME; ENV.forEach(k => delete process.env[k]); rmSync(home,{recursive:true,force:true}) })

describe('baseUrl resolution order', () => {
  it('explicit --port wins over everything', () => {
    process.env.BERTH_PORT = '8000'
    expect(__resolveBaseUrl({ port: '9001' })).toBe('http://127.0.0.1:9001')
  })
  it('$BERTH_PORT beats $PORT', () => {
    process.env.BERTH_PORT = '8000'; process.env.PORT = '7000'
    expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:8000')
  })
  it('$PORT used when no BERTH_PORT', () => { process.env.PORT = '7000'; expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:7000') })
  it('falls back to server.json when no env', () => {
    writeServerFile({ port: 6543, host: '127.0.0.1' })
    expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:6543')
  })
  it('defaults to 7777', () => { expect(__resolveBaseUrl({})).toBe('http://127.0.0.1:7777') })
})
