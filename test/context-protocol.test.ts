import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocStore } from '../src/data/docstore'
import { seedDefaultProtocol, resolveProtocol, GLOBAL_PROTOCOL_REF } from '../src/data/context-protocol'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-proto-')) }

describe('context-protocol', () => {
  it('seedDefaultProtocol writes the global AGENTS.md once and does not clobber edits', () => {
    const root = tmpRoot(); const ds = new DocStore(root)
    seedDefaultProtocol(ds, 'zh-CN')
    const abs = ds.resolveDocPath(GLOBAL_PROTOCOL_REF)!
    expect(existsSync(abs)).toBe(true)
    writeFileSync(abs, '# edited')
    seedDefaultProtocol(ds, 'zh-CN')   // idempotent: must NOT overwrite
    expect(ds.readDoc(abs).content).toBe('# edited')
  })

  it('resolveProtocol falls back to the global protocol path when no per-project override', () => {
    const root = tmpRoot(); const ds = new DocStore(root)
    const r = resolveProtocol(ds, 'zh-CN', 'Berth')
    expect(r.protocolPath).toBe(ds.resolveDocPath(GLOBAL_PROTOCOL_REF))
    expect(r.compactRules.length).toBeGreaterThanOrEqual(4)
  })

  it('resolveProtocol prefers a per-project AGENTS.md when present', () => {
    const root = tmpRoot(); const ds = new DocStore(root)
    const projDir = join(root, 'projects', 'Berth'); mkdirSync(projDir, { recursive: true })
    const projProto = join(projDir, 'AGENTS.md'); writeFileSync(projProto, '# project override')
    const r = resolveProtocol(ds, 'zh-CN', 'Berth')
    expect(r.protocolPath).toBe(projProto)
  })
})
