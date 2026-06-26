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
      taskNote: '这次先只处理启动弹窗',
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
        prompt: '这次先只处理启动弹窗',
        addDirs: ['/docs'],
        ctxProject: true,
        ctxTask: true,
      },
    })
  })

  it('primes the backend launch independently and resolves the pending launch id', () => {
    const prevLocation = (globalThis as any).location
    const prevWebSocket = (globalThis as any).WebSocket
    const sockets: any[] = []
    class FakeWebSocket {
      onmessage: ((e: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      closed = false
      constructor(public url: string) { sockets.push(this) }
      close() { this.closed = true }
    }
    ;(globalThis as any).location = { protocol: 'http:', host: 'localhost:5173' }
    ;(globalThis as any).WebSocket = FakeWebSocket
    try {
      const resolved: Array<[string, string]> = []
      startFreshLaunch({
        dest: 'task',
        title: 'T',
        taskTitle: 'T',
        taskNote: '只做启动',
        cli: 'codex',
        cargo: initCargo(['/repo'], '/repo', true),
        project: { id: 'p1', name: 'Berth', workspaceCwd: '/workspace/p1' },
        projectId: 'p1',
        todoKey: 'task-1',
        sessions: [],
        addPending: () => {},
        resolvePending: (tempId, sessionId) => resolved.push([tempId, sessionId]),
        openDrawer: () => {},
        makeLaunchToken: () => 'launch-1',
      })

      expect(sockets).toHaveLength(1)
      expect(sockets[0].url).toContain('/pty?')
      expect(sockets[0].url).toContain('new=1')
      expect(sockets[0].url).toContain('launchToken=launch-1')
      expect(sockets[0].url).toContain('prompt=')
      sockets[0].onmessage?.({ data: JSON.stringify({ __berth: 'launched', sessionId: 'live-1' }) })
      expect(resolved).toEqual([['launch-1', 'live-1']])
    } finally {
      ;(globalThis as any).location = prevLocation
      ;(globalThis as any).WebSocket = prevWebSocket
    }
  })
})
