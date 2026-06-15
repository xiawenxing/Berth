import { describe, it, expect } from 'vitest'
import { openStore } from '../src/db/store'
import {
  getTaskFieldConfig, setTaskFieldConfig,
  DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_STATUS, DEFAULT_PRIORITY,
} from '../src/data/task-config'

describe('data/task-config', () => {
  it('falls back to defaults when unset', () => {
    const store = openStore(':memory:')
    const cfg = getTaskFieldConfig(store)
    expect(cfg.statuses).toEqual(DEFAULT_STATUSES)
    expect(cfg.priorities).toEqual(DEFAULT_PRIORITIES)
    // default-for-new-task: status = first item, priority = explicit P1 (not the first P0)
    expect(cfg.defaultStatus).toBe(DEFAULT_STATUS)
    expect(cfg.defaultStatus).toBe('待办')
    expect(cfg.defaultPriority).toBe(DEFAULT_PRIORITY)
    expect(cfg.defaultPriority).toBe('P1')
  })

  it('round-trips set/get', () => {
    const store = openStore(':memory:')
    setTaskFieldConfig(store, { statuses: ['todo', 'doing', 'done'], priorities: ['hi', 'lo'] })
    const cfg = getTaskFieldConfig(store)
    expect(cfg.statuses).toEqual(['todo', 'doing', 'done'])
    expect(cfg.priorities).toEqual(['hi', 'lo'])
    // P1 not in the custom priority list → fall back to the first item
    expect(cfg.defaultStatus).toBe('todo')
    expect(cfg.defaultPriority).toBe('hi')
  })

  it('trims, drops blanks, and persists only provided lists', () => {
    const store = openStore(':memory:')
    setTaskFieldConfig(store, { statuses: ['  a  ', '', '  ', 'b'] })
    const cfg = getTaskFieldConfig(store)
    expect(cfg.statuses).toEqual(['a', 'b'])
    expect(cfg.priorities).toEqual(DEFAULT_PRIORITIES)   // untouched
  })

  it('rejects empty / non-array / duplicate lists', () => {
    const store = openStore(':memory:')
    expect(() => setTaskFieldConfig(store, { statuses: [] })).toThrow(/at least one/)
    expect(() => setTaskFieldConfig(store, { statuses: ['  ', ''] })).toThrow(/at least one/)
    expect(() => setTaskFieldConfig(store, { priorities: 'P0,P1' as any })).toThrow(/must be an array/)
    expect(() => setTaskFieldConfig(store, { statuses: ['a', 'a'] })).toThrow(/duplicate/)
  })

  it('ignores invalid stored JSON and uses defaults', () => {
    const store = openStore(':memory:')
    store.setSetting('taskStatuses', 'not json')
    store.setSetting('taskPriorities', '{}')
    const cfg = getTaskFieldConfig(store)
    expect(cfg.statuses).toEqual(DEFAULT_STATUSES)
    expect(cfg.priorities).toEqual(DEFAULT_PRIORITIES)
  })
})
