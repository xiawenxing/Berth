import { describe, it, expect } from 'vitest'
import { parseStatusSentinel, decideTaskStatusReconcile } from '../src/server/task-status-sentinel'

const VOCAB = ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消']

describe('parseStatusSentinel', () => {
  it('returns the status for a matching taskId + valid status', () => {
    const text = 'done.\nBERTH_TASK_STATUS: task-123 已完成\nthanks'
    expect(parseStatusSentinel(text, 'task-123', VOCAB)).toBe('已完成')
  })
  it('ignores a sentinel for a different taskId', () => {
    expect(parseStatusSentinel('BERTH_TASK_STATUS: other 已完成', 'task-123', VOCAB)).toBeNull()
  })
  it('ignores an unknown status', () => {
    expect(parseStatusSentinel('BERTH_TASK_STATUS: task-123 finished', 'task-123', VOCAB)).toBeNull()
  })
  it('takes the LAST valid sentinel when several appear', () => {
    const text = 'BERTH_TASK_STATUS: task-123 待验证\nBERTH_TASK_STATUS: task-123 已完成'
    expect(parseStatusSentinel(text, 'task-123', VOCAB)).toBe('已完成')
  })
  it('returns null when no sentinel is present', () => {
    expect(parseStatusSentinel('no marker here', 'task-123', VOCAB)).toBeNull()
  })
  it('accepts a markdown quote-prefixed sentinel', () => {
    expect(parseStatusSentinel('> BERTH_TASK_STATUS: task-123 已完成', 'task-123', VOCAB)).toBe('已完成')
  })
  it('accepts a list-item-prefixed sentinel', () => {
    expect(parseStatusSentinel('- BERTH_TASK_STATUS: task-123 阻塞', 'task-123', VOCAB)).toBe('阻塞')
  })
})

describe('decideTaskStatusReconcile', () => {
  it('no-ops when the task already moved off inProgress (Path A worked)', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '已完成', inProgress: '进行中', sentinelStatus: '阻塞' })).toBeNull()
  })
  it('applies the sentinel when still in progress', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '进行中', inProgress: '进行中', sentinelStatus: '已完成' })).toBe('已完成')
  })
  it('leaves in progress when there is no sentinel', () => {
    expect(decideTaskStatusReconcile({ currentStatus: '进行中', inProgress: '进行中', sentinelStatus: null })).toBeNull()
  })
  it('no-ops when currentStatus is null', () => {
    expect(decideTaskStatusReconcile({ currentStatus: null, inProgress: '进行中', sentinelStatus: '已完成' })).toBeNull()
  })
})
