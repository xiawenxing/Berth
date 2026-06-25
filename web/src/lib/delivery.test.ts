import { describe, expect, it } from 'vitest'
import { deliveryStats, deliveryTasks, localTodayISO } from './delivery'

describe('deliveryTasks', () => {
  it('includes today due tasks and overdue unfinished tasks', () => {
    const tasks = [
      { id: 'done-overdue', ddl: '2026-06-24', status: '已完成' },
      { id: 'overdue', ddl: '2026-06-24', status: '进行中' },
      { id: 'today-open', ddl: '2026-06-25', status: '待办' },
      { id: 'today-done', ddl: '2026-06-25', status: '已完成' },
      { id: 'future', ddl: '2026-06-26', status: '待办' },
      { id: 'none', ddl: null, status: '待办' },
    ]

    expect(deliveryTasks(tasks, '2026-06-25').map((task) => task.id)).toEqual([
      'overdue',
      'today-open',
      'today-done',
    ])
  })

  it('reports completion against the shared delivery set', () => {
    const stats = deliveryStats([
      { ddl: '2026-06-24', status: '进行中' },
      { ddl: '2026-06-25', status: '已完成' },
      { ddl: '2026-06-25', status: '待办' },
    ], '2026-06-25')

    expect(stats.done).toBe(1)
    expect(stats.total).toBe(3)
  })
})

describe('localTodayISO', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(localTodayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
