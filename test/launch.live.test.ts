import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { collectLogicalSessions } from '../src/sessions'
import { resumeSession } from '../src/pty/launch'

const live = process.env.BERTH_LIVE === '1' ? describe : describe.skip
live('live PTY resume', () => {
  it('resumes the most-recent non-deleted real session and receives output within 8s', async () => {
    const all = collectLogicalSessions({ claudeRoot: homedir()+'/.claude/projects/',
      codexRoot: homedir()+'/.codex/', cocoRoot: homedir()+'/Library/Caches/coco/' })
    const target = all.filter(s => !s.deleted && s.resume).sort((a,b)=>b.updatedAt-a.updatedAt)[0]
    console.log('S4 resuming:', target.resume!.cli, target.sessionId, 'cwd=', target.cwd)
    const pty = resumeSession(target)
    const got = await new Promise<boolean>((res) => {
      let buf = ''; const t = setTimeout(() => res(buf.length > 0), 8000)
      pty.onData(d => { buf += d; if (buf.length > 50) { clearTimeout(t); res(true) } })
    })
    pty.kill()
    expect(got).toBe(true)
  }, 15000)
})
