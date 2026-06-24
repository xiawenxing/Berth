import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The service calls the real `runAgent` (no injection seam). Mock it so the "agent" deterministically
// returns a FULL updated markdown doc: take the current context doc and append a progress-log line,
// which gives updateContext a real section diff to report.
const runAgentMock = vi.fn()
vi.mock('../src/agent/index', () => ({
  runAgent: (...args: any[]) => runAgentMock(...args),
}))

import { resolveSessionContextTarget, runConsolidation, runContextUpdate, type ContextTarget } from '../src/server/context-consolidate-service'
import { DocStore } from '../src/data/docstore'
import { ensureContextDoc } from '../src/data/context-doc'
import { setDocGitEnabled, __resetDocGit, headCommit } from '../src/data/doc-git'
import { contextStrings } from '../src/i18n'

function tmpRoot() { return mkdtempSync(join(tmpdir(), 'berth-ctxsvc-')) }
const getCfg = () => ({ logMaxLines: 10_000, logKeep: 50, docMaxChars: 1_000_000, docKeepChars: 500_000 })

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

describe('runContextUpdate', () => {
  beforeEach(() => runAgentMock.mockReset())

  it('userInput-only: runs the updater and reports the section diff (git off)', async () => {
    const ds = new DocStore(tmpRoot())
    const c = contextStrings('zh-CN')
    // The mocked agent appends a new line under the progress-log section of whatever doc it's given.
    runAgentMock.mockImplementation(async () => {
      const ref = ds.taskDocRef('u2')
      const abs = ds.resolveDocPath(ref)!
      const doc = readFileSync(abs, 'utf8')
      const lines = doc.split('\n')
      const idx = lines.findIndex(l => l.trim() === c.logHeading.trim())
      lines.splice(idx + 1, 0, '- 2026-06-16: did the userInput thing')
      return lines.join('\n')
    })

    const target: ContextTarget = {
      kind: 'task', key: 'u2', title: 'UserInput Task', projectName: 'P',
      ref: ds.taskDocRef('u2'), abs: ds.resolveDocPath(ds.taskDocRef('u2'))!,
    }

    const outcome = await runContextUpdate({
      target, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' },
      userInput: '补充一些信息', date: '2026-06-16', getCfg,
    })

    expect(outcome.ok).toBe(true)
    expect(runAgentMock).toHaveBeenCalledOnce()
    expect(outcome.changed).toContain(c.logHeading.replace(/^#+\s*/, '').trim())
    expect(outcome.added ?? []).toEqual([])
    expect(outcome.removed ?? []).toEqual([])
    // The new line was actually written to disk.
    const abs = ds.resolveDocPath(ds.taskDocRef('u2'))!
    expect(readFileSync(abs, 'utf8')).toContain('did the userInput thing')
  })

  it('no input guard: returns !ok with reason "no input or transcript" when neither userInput nor transcript is given', async () => {
    const ds = new DocStore(tmpRoot())
    const target: ContextTarget = {
      kind: 'task', key: 'u3', title: 'Guard Task', projectName: null,
      ref: ds.taskDocRef('u3'), abs: ds.resolveDocPath(ds.taskDocRef('u3'))!,
    }

    const outcome = await runContextUpdate({
      target, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' },
      date: '2026-06-16', getCfg,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('no input or transcript')
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  // Regression (I1): with git ON, the doc write commits C1, then rotation writes the rolled doc +
  // archive as further commits C2/C3. The returned `commit` must be C1 (the doc update) so "回滚此次"
  // reverts the user's change — NOT the later archive/rotation commit (which is now HEAD).
  it('git on + rotation: returns the doc-update commit, not a later rotation/archive commit', async () => {
    __resetDocGit()
    setDocGitEnabled(true)
    try {
      const ds = new DocStore(tmpRoot())
      const c = contextStrings('zh-CN')
      const key = 'u4'
      const target: ContextTarget = {
        kind: 'task', key, title: 'Rotation Task', projectName: 'P',
        ref: ds.taskDocRef(key), abs: ds.resolveDocPath(ds.taskDocRef(key))!,
      }

      // Create the doc, then pre-seed its progress log with 3 dated entries so that ONE more
      // appended line (4 entries) exceeds the deliberately-low logMaxLines=3 and forces a roll.
      ensureContextDoc(ds, 'task', key, { title: target.title, projectName: target.projectName, locale: 'zh-CN' })
      const seeded = (() => {
        const doc = readFileSync(target.abs, 'utf8')
        const lines = doc.split('\n')
        const idx = lines.findIndex(l => l.trim() === c.logHeading.trim())
        lines.splice(idx + 1, 0, '- 2026-06-13: seed one', '- 2026-06-14: seed two', '- 2026-06-15: seed three')
        return lines.join('\n')
      })()
      ds.writeDoc(target.abs, seeded, { message: 'seed log' })

      // The mocked agent returns the FULL seeded doc with ONE more progress line appended → a real
      // diff for updateContext AND a 4th entry so rotateContextDocOnDisk actually rotates.
      runAgentMock.mockImplementation(async () => {
        const doc = readFileSync(target.abs, 'utf8')
        const lines = doc.split('\n')
        const idx = lines.findIndex(l => l.trim() === c.logHeading.trim())
        lines.splice(idx + 1, 0, '- 2026-06-16: did the rotation thing')
        return lines.join('\n')
      })

      const lowCfg = () => ({ logMaxLines: 3, logKeep: 2, docMaxChars: 1_000_000, docKeepChars: 500_000 })
      const outcome = await runContextUpdate({
        target, docStore: ds, locale: 'zh-CN', agent: { cli: 'claude' },
        userInput: '补充触发滚动的信息', date: '2026-06-16', getCfg: lowCfg,
      })

      expect(outcome.ok).toBe(true)
      expect(outcome.rotated).toBe(true)                // rotation actually fired
      expect(outcome.commit).toBeTruthy()

      // The returned commit predates the rotation commits: HEAD has advanced past it.
      expect(outcome.commit).not.toBe(headCommit(ds.root))

      // And that commit's version of the context file contains the user's appended line — i.e. it's
      // the doc-update commit (C1), not the archive write.
      const atCommit = execFileSync('git', ['show', outcome.commit + ':' + target.ref], { cwd: ds.root }).toString()
      expect(atCommit).toContain('did the rotation thing')
    } finally {
      setDocGitEnabled(false)
    }
  })
})
