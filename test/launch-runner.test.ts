import { describe, expect, it } from 'vitest'
import { initCargo } from '../web/src/lib/launch-cargo'
import { startFreshLaunch, type LaunchDrawerSession, type LaunchPending } from '../web/src/lib/launch-runner'

describe('startFreshLaunch', () => {
  it('opens a task launch directly with the configured agent and cargo', () => {
    const pending: LaunchPending[] = []
    const drawers: LaunchDrawerSession[] = []
    const cargo = initCargo(['/repo', '/docs'], '/repo', true)

    const token = startFreshLaunch({
      dest: 'task',
      title: '修新建任务立即执行',
      taskTitle: '修新建任务立即执行',
      cli: 'codex',
      cargo,
      project: { id: 'p1', name: 'Berth', workspaceCwd: '/workspace/p1' },
      projectId: 'p1',
      todoKey: 'task-1',
      sessions: [{ sessionId: 'old', cli: 'codex', cwd: '/repo', updatedAt: 1 }],
      addPending: (p) => pending.push(p),
      openDrawer: (d) => drawers.push(d),
      makeLaunchToken: () => 'launch-1',
      now: () => 1234,
    })

    expect(token).toBe('launch-1')
    expect(pending).toEqual([
      {
        tempId: 'launch-1',
        cli: 'codex',
        cwd: '/repo',
        cwdLabel: '/repo',
        projectId: 'p1',
        todoKey: 'task-1',
        sessionId: null,
        knownIds: ['old'],
        createdAt: 1234,
      },
    ])
    expect(drawers[0]).toMatchObject({
      title: '修新建任务立即执行',
      cli: 'codex',
      cwd: '/repo',
      status: 'sail',
      task: '修新建任务立即执行',
      launch: {
        cli: 'codex',
        cwd: '/repo',
        launchToken: 'launch-1',
        projectId: 'p1',
        todoKey: 'task-1',
        addDirs: ['/docs'],
        ctxProject: true,
        ctxTask: true,
      },
    })
  })
})
