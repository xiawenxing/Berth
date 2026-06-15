import { describe, it, expect } from 'vitest'
import { parseFlags, selectTask, pickDoneStatus, formatTaskLine, runTaskCli, type TaskLite } from '../src/cli-data'

const T = (over: Partial<TaskLite>): TaskLite => ({ id: 'id', title: 't', status: '待办', priority: 'P1', project: null, ...over })

describe('parseFlags', () => {
  it('separates positionals, value flags, and boolean flags', () => {
    expect(parseFlags(['hello', 'world', '--project', 'Berth', '--confirm', '--status', '进行中']))
      .toEqual({ pos: ['hello', 'world'], flags: { project: 'Berth', confirm: true, status: '进行中' } })
  })
  it('treats --json / --create-option as booleans', () => {
    expect(parseFlags(['--json', '--create-option']).flags).toEqual({ json: true, 'create-option': true })
  })
})

describe('selectTask', () => {
  const tasks = [
    T({ id: 'aaaaaaaa-1111', title: '给 Berth 加能力' }),
    T({ id: 'bbbbbbbb-2222', title: '修红点' }),
    T({ id: 'cccccccc-3333', title: '修红点的回归' }),
  ]
  it('matches an exact id', () => {
    expect(selectTask(tasks, 'aaaaaaaa-1111').map(t => t.id)).toEqual(['aaaaaaaa-1111'])
  })
  it('matches an id prefix (>=6 chars)', () => {
    expect(selectTask(tasks, 'bbbbbb').map(t => t.id)).toEqual(['bbbbbbbb-2222'])
  })
  it('matches a title substring, returning all matches for disambiguation', () => {
    expect(selectTask(tasks, '修红点').map(t => t.id)).toEqual(['bbbbbbbb-2222', 'cccccccc-3333'])
    expect(selectTask(tasks, '加能力')).toHaveLength(1)
    expect(selectTask(tasks, 'nope')).toHaveLength(0)
  })
})

describe('pickDoneStatus', () => {
  it('prefers a 完成/done-like status, else the last', () => {
    expect(pickDoneStatus(['待办', '进行中', '已完成', '已取消'])).toBe('已完成')
    expect(pickDoneStatus(['todo', 'in progress', 'done'])).toBe('done')
    expect(pickDoneStatus(['a', 'b'])).toBe('b')
    expect(pickDoneStatus([])).toBeNull()
  })
})

describe('formatTaskLine', () => {
  it('renders status, priority, project, title and short id', () => {
    const line = formatTaskLine(T({ id: 'abcdef12-9999', title: '写文档', project: 'Berth' }))
    expect(line).toContain('待办')
    expect(line).toContain('Berth')
    expect(line).toContain('写文档')
    expect(line).toContain('[abcdef12]')
  })
})

describe('berth task progress deprecation', () => {
  it('throws pointing at `berth task log` before any I/O', async () => {
    await expect(runTaskCli(['progress', 'some-task', 'hello'])).rejects.toThrow(/berth task log/)
  })
})
