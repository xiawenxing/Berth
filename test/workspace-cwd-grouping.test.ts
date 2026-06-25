import { describe, it, expect } from 'vitest'
import { normalizeWorkspaceCwd } from '../src/server/api'

// A project's Berth-assigned default dir, by project id (the form workspaceCwd uses in the API).
const wsDirFor = (pid: string) => `/tmp/berth-clean/workspaces/${pid}`
// Stand-in canonicalizer: collapse the macOS /tmp -> /private/tmp alias the way realpath would.
const canon = (p: string) => p.replace(/^\/private\/tmp\//, '/tmp/')

describe('normalizeWorkspaceCwd', () => {
  it('rewrites a symlink-variant of the workspace dir to the canonical workspace form', () => {
    // claude records the realpath (/private/tmp); it must still group under 项目默认目录.
    const out = normalizeWorkspaceCwd('/private/tmp/berth-clean/workspaces/P1', 'P1', wsDirFor, canon)
    expect(out).toBe('/tmp/berth-clean/workspaces/P1')
  })
  it('leaves an exact-match workspace cwd untouched (coco form)', () => {
    const out = normalizeWorkspaceCwd('/tmp/berth-clean/workspaces/P1', 'P1', wsDirFor, canon)
    expect(out).toBe('/tmp/berth-clean/workspaces/P1')
  })
  it('leaves a real code-directory cwd untouched (not the workspace dir)', () => {
    const out = normalizeWorkspaceCwd('/Users/me/code/app', 'P1', wsDirFor, canon)
    expect(out).toBe('/Users/me/code/app')
  })
  it('passes through when there is no attached project', () => {
    expect(normalizeWorkspaceCwd('/private/tmp/berth-clean/workspaces/P1', null, wsDirFor, canon))
      .toBe('/private/tmp/berth-clean/workspaces/P1')
  })
  it('passes through a null cwd', () => {
    expect(normalizeWorkspaceCwd(null, 'P1', wsDirFor, canon)).toBeNull()
  })
})
