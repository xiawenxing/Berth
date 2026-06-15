import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The service calls the real `runAgent` (no injection seam). Mock it so the "agent" deterministically
// returns a FULL updated markdown doc: take the current context doc and append a progress-log line,
// which gives updateContext a real section diff to report.
const runAgentMock = vi.fn()
vi.mock('../src/agent/index', () => ({
  runAgent: (...args: any[]) => runAgentMock(...args),
}))

import { resolveSessionContextTarget, runConsolidation } from '../src/server/context-consolidate-service'
import { DocStore } from '../src/data/docstore'
import { contextStrings } from '../src/i18n'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-ctxsvc-')) }
const getCfg = () => ({ logMaxLines: 10_000, logKeep: 50 })

describe('resolveSessionContextTarget', () => {
  const docStore: any = { taskDocRef: (id: string) => `tasks/${id}/index.md`, projectDocRef: (n: string) => `projects/${n}/index.md`, resolveDocPath: (r: string) => '/root/' + r }
  it('maps a task-linked session to its task context', () => {
    const t = resolveSessionContextTarget({ sessionId: 's', todoKey: 'u1', projectId: null } as any, { title: 'T', project: 'P' } as any, docStore)
    expect(t).toEqual({ kind: 'task', key: 'u1', title: 'T', projectName: 'P', ref: 'tasks/u1/index.md', abs: '/root/tasks/u1/index.md' })
  })
  it('maps a project-only session to its project context', () => {
    const t = resolveSessionContextTarget({ sessionId: 's', todoKey: null, projectId: 'Berth' } as any, null, docStore)
    expect(t).toEqual({ kind: 'project', key: 'Berth', title: 'Berth', projectName: 'Berth', ref: 'projects/Berth/index.md', abs: '/root/projects/Berth/index.md' })
  })
  it('returns null when the session is linked to neither', () => {
    expect(resolveSessionContextTarget({ sessionId: 's', todoKey: null, projectId: null } as any, null, docStore)).toBeNull()
  })
})

describe('runConsolidation', () => {
  beforeEach(() => runAgentMock.mockReset())

  it('runs the unified updater and reports the section diff (git off)', async () => {
    const ds = new DocStore(tmpRoot())
    const c = contextStrings('zh-CN')
    // The mocked agent appends a new line under the progress-log section of whatever doc it's given.
    runAgentMock.mockImplementation(async () => {
      const ref = ds.taskDocRef('u1')
      const abs = ds.resolveDocPath(ref)!
      const doc = readFileSync(abs, 'utf8')
      const lines = doc.split('\n')
      const idx = lines.findIndex(l => l.trim() === c.logHeading.trim())
      lines.splice(idx + 1, 0, '- 2026-06-16: did the thing')
      return lines.join('\n')
    })

    const transcriptPath = join(tmpRoot(), 'transcript.txt')
    writeFileSync(transcriptPath, 'user: do X\nassistant: done', 'utf8')

    const outcome = await runConsolidation({
      session: { sessionId: 's', todoKey: 'u1', projectId: null, contentSourcePath: transcriptPath },
      task: { title: 'T', project: 'P' },
      docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' },
      getCfg,
    })

    expect(outcome.ok).toBe(true)
    expect(runAgentMock).toHaveBeenCalledOnce()
    expect(outcome.changed).toContain(c.logHeading.replace(/^#+\s*/, '').trim())
    expect(outcome.added ?? []).toEqual([])
    expect(outcome.removed ?? []).toEqual([])
    // The new line was actually written to disk.
    const abs = ds.resolveDocPath(ds.taskDocRef('u1'))!
    expect(readFileSync(abs, 'utf8')).toContain('did the thing')
  })

  it('reports !ok when the session is linked to neither a task nor a project', async () => {
    const ds = new DocStore(tmpRoot())
    const outcome = await runConsolidation({
      session: { sessionId: 's', todoKey: null, projectId: null, contentSourcePath: null },
      task: null, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' }, getCfg,
    })
    expect(outcome.ok).toBe(false)
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('reports !ok when there is no readable transcript', async () => {
    const ds = new DocStore(tmpRoot())
    const outcome = await runConsolidation({
      session: { sessionId: 's', todoKey: 'u1', projectId: null, contentSourcePath: '/nope/missing.txt' },
      task: { title: 'T', project: 'P' }, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' }, getCfg,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('no readable transcript')
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('reports !ok when the agent produces no usable update', async () => {
    const ds = new DocStore(tmpRoot())
    runAgentMock.mockResolvedValue('oops')                 // too short → guarded out by updateContext
    const transcriptPath = join(tmpRoot(), 'transcript.txt')
    writeFileSync(transcriptPath, 'user: do X', 'utf8')
    const outcome = await runConsolidation({
      session: { sessionId: 's', todoKey: 'u1', projectId: null, contentSourcePath: transcriptPath },
      task: { title: 'T', project: 'P' }, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' }, getCfg,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('agent produced no usable update')
  })
})
