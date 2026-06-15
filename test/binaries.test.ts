import { describe, it, expect } from 'vitest'
import { resolveAgentBinary } from '../src/pty/binaries'
import { resumeArgv } from '../src/pty/launch'
describe('binaries + argv', () => {
  it('pins coco to ~/.local/bin and never returns the trae IDE launcher', { timeout: 25000 }, () => {
    expect(resolveAgentBinary('coco')).toMatch(/\/\.local\/bin\/coco$/)
    expect(resolveAgentBinary('coco')).not.toBe('/usr/local/bin/trae')
  })
  it('maps each cli to a resume argv template', () => {
    expect(resumeArgv('claude', 'U')).toEqual(['--resume', 'U'])
    expect(resumeArgv('codex', 'U')).toEqual(['resume', 'U'])
    expect(resumeArgv('coco', 'U')).toEqual(['--resume=U'])   // pflag optional-value: must use =id, see launch.test.ts
  })
})
