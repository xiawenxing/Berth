import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import { migrateSessionImportOnce } from '../src/data/migrate-session-import'
import type { LogicalSession } from '../src/types'

const mk = (id: string, cwd: string | null): LogicalSession => ({
  sessionId: id, cli: 'codex', cwd, title: id, updatedAt: 1,
  contentSourcePath: `/x/${id}.jsonl`, resume: { cli: 'codex', id }, copies: [], deleted: false,
})

describe('migrateSessionImportOnce', () => {
  it('seeds session_import with EXACTLY the old visible set, so nothing vanishes', () => {
    const s = openStore(':memory:')
    // old roots come from: session_import_dir ∪ project_path ∪ launch_intent.cwd
    s.addSessionImportDir('/imported')
    s.addProjectPath('P', '/cargo', true)
    s.addLaunchIntent({ id: 'i1', cli: 'codex', cwd: '/launched', projectId: 'P', todoKey: null, sessionId: null, createdAt: 1, bound: false })
    // and an attached session (curated) in a cwd that is NOT any root
    s.setAttach('att', 'P', 'confirmed')

    const all = [
      mk('inDir', '/imported'),    // visible via session_import_dir
      mk('inCargo', '/cargo'),     // visible via project_path (will STOP being a root post-migration)
      mk('inLaunch', '/launched'), // visible via launch_intent.cwd (also stops)
      mk('att', '/elsewhere'),     // visible via attach (curated)
      mk('orphan', '/nowhere'),    // NOT visible under any rule
    ]
    const n = migrateSessionImportOnce(s, all)
    expect(n).toBe(4)
    expect([...s.allSessionImportSet()].sort()).toEqual(['att', 'inCargo', 'inDir', 'inLaunch'])
  })

  it('is guarded — runs once', () => {
    const s = openStore(':memory:')
    s.addSessionImportDir('/imported')
    expect(migrateSessionImportOnce(s, [mk('inDir', '/imported')])).toBe(1)
    // second call is a no-op even with more sessions
    expect(migrateSessionImportOnce(s, [mk('inDir', '/imported'), mk('x', '/imported')])).toBe(0)
    expect([...s.allSessionImportSet()]).toEqual(['inDir'])
  })
})
