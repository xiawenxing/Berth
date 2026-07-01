import { describe, expect, it } from 'vitest'
import { filterTaskOptions } from './task-picker'
import type { ApiTask } from './api'

const t = (over: Partial<ApiTask>): ApiTask => ({ id: 'x', title: 'task', status: '待办', ...over })

describe('filterTaskOptions', () => {
  it('keeps only tasks belonging to the given project', () => {
    const tasks = [
      t({ id: 'a', title: 'A', projectId: 'p1' }),
      t({ id: 'b', title: 'B', projectId: 'p2' }),
      t({ id: 'c', title: 'C', projectId: 'p1' }),
    ]
    expect(filterTaskOptions(tasks, 'p1', '').map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('shows all projects when no projectId is given (project-less launch)', () => {
    const tasks = [t({ id: 'a', projectId: 'p1' }), t({ id: 'b', projectId: 'p2' })]
    expect(filterTaskOptions(tasks, undefined, '').map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('excludes done and cancelled tasks', () => {
    const tasks = [
      t({ id: 'a', title: 'open', status: '进行中', projectId: 'p1' }),
      t({ id: 'b', title: 'shipped', status: '已完成', projectId: 'p1' }),
      t({ id: 'c', title: 'dropped', status: '已取消', projectId: 'p1' }),
    ]
    expect(filterTaskOptions(tasks, 'p1', '').map((x) => x.id)).toEqual(['a'])
  })

  it('filters by a case-insensitive substring of the title', () => {
    const tasks = [
      t({ id: 'a', title: '修复登录超时', projectId: 'p1' }),
      t({ id: 'b', title: '重构 PTY 会话层', projectId: 'p1' }),
    ]
    expect(filterTaskOptions(tasks, 'p1', 'pty').map((x) => x.id)).toEqual(['b'])
    expect(filterTaskOptions(tasks, 'p1', '登录').map((x) => x.id)).toEqual(['a'])
  })

  it('trims the query and returns all open tasks for a blank query', () => {
    const tasks = [t({ id: 'a', projectId: 'p1' }), t({ id: 'b', projectId: 'p1' })]
    expect(filterTaskOptions(tasks, 'p1', '   ').map((x) => x.id)).toEqual(['a', 'b'])
  })
})
