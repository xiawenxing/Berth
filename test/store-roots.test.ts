import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { storeRoots } from '../src/server/store-singleton'

// storeRoots() reads dataHome() at call time, so BERTH_TEST_HOME can be toggled per case. (The DB the
// singleton opens at import lands at the real ~/.berth because the env is unset during module load.)
const orig = process.env.BERTH_TEST_HOME
afterEach(() => { if (orig === undefined) delete process.env.BERTH_TEST_HOME; else process.env.BERTH_TEST_HOME = orig })

describe('storeRoots', () => {
  it('scans the real CLI stores under homedir by default', () => {
    delete process.env.BERTH_TEST_HOME
    expect(storeRoots()).toEqual({
      claudeRoot: join(homedir(), '.claude', 'projects') + '/',
      codexRoot: join(homedir(), '.codex') + '/',
      cocoRoot: join(homedir(), 'Library', 'Caches', 'coco') + '/',
    })
  })

  it('redirects every CLI store under BERTH_TEST_HOME so the sidebar starts empty', () => {
    process.env.BERTH_TEST_HOME = '/tmp/berth-clean'
    expect(storeRoots()).toEqual({
      claudeRoot: '/tmp/berth-clean/.claude/projects/',
      codexRoot: '/tmp/berth-clean/.codex/',
      cocoRoot: '/tmp/berth-clean/Library/Caches/coco/',
    })
  })
})
