// Canonical, user-configurable task field vocabularies (status / priority).
// Stored in app_setting (JSON arrays), independent of any sync adapter. Unset/invalid → defaults,
// so existing stores keep working.
//
// The default value for a NEW task is configurable (app_setting taskDefaultStatus/taskDefaultPriority)
// but not yet surfaced in the UI; when unset it falls back to DEFAULT_STATUS / DEFAULT_PRIORITY if
// those still exist in the list, otherwise the list's first item. (Priority's natural list order is
// P0..P3, so "first item" would be P0 — hence an explicit P1 default to preserve behavior.)

type Store = { getSetting(key: string): string | null; setSetting(key: string, value: string): void }

export const DEFAULT_STATUSES = ['待办', '进行中', '阻塞', '待验证', '已完成', '已取消']
export const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const DEFAULT_STATUS = '待办'
export const DEFAULT_PRIORITY = 'P1'

const STATUS_KEY = 'taskStatuses'
const PRIORITY_KEY = 'taskPriorities'
const DEFAULT_STATUS_KEY = 'taskDefaultStatus'
const DEFAULT_PRIORITY_KEY = 'taskDefaultPriority'

export interface TaskFieldConfig {
  statuses: string[]
  priorities: string[]
  defaultStatus: string
  defaultPriority: string
}

function readList(store: Store, key: string, fallback: string[]): string[] {
  const raw = store.getSetting(key)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length && parsed.every(v => typeof v === 'string' && v.trim())) {
      return parsed
    }
  } catch { /* fall through to default */ }
  return fallback
}

/** Resolve the default: the stored value if still in the list, else the seed if in the list, else list[0]. */
function resolveDefault(store: Store, key: string, list: string[], seed: string): string {
  const stored = store.getSetting(key)
  if (stored && list.includes(stored)) return stored
  if (list.includes(seed)) return seed
  return list[0]
}

export function getTaskFieldConfig(store: Store): TaskFieldConfig {
  const statuses = readList(store, STATUS_KEY, DEFAULT_STATUSES)
  const priorities = readList(store, PRIORITY_KEY, DEFAULT_PRIORITIES)
  return {
    statuses,
    priorities,
    defaultStatus: resolveDefault(store, DEFAULT_STATUS_KEY, statuses, DEFAULT_STATUS),
    defaultPriority: resolveDefault(store, DEFAULT_PRIORITY_KEY, priorities, DEFAULT_PRIORITY),
  }
}

/** Map the configured vocabulary to its pending / next-in-progress roles. */
export function resolveStatusRoles(cfg: TaskFieldConfig): { pending: string; inProgress: string | null } {
  const pending = cfg.defaultStatus
  const idx = cfg.statuses.indexOf(pending)
  const inProgress = idx >= 0 && idx + 1 < cfg.statuses.length ? cfg.statuses[idx + 1] : null
  return { pending, inProgress }
}

/** Validate a candidate list: non-empty array of non-empty, trimmed, unique strings. */
function clean(list: unknown, label: string): string[] {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array`)
  const out = list.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  if (!out.length) throw new Error(`${label} must have at least one value`)
  if (new Set(out).size !== out.length) throw new Error(`${label} has duplicate values`)
  return out
}

/** Persist provided lists (each optional). Throws on invalid input; returns the resulting config. */
export function setTaskFieldConfig(store: Store, patch: { statuses?: unknown; priorities?: unknown }): TaskFieldConfig {
  if (patch.statuses !== undefined) store.setSetting(STATUS_KEY, JSON.stringify(clean(patch.statuses, 'statuses')))
  if (patch.priorities !== undefined) store.setSetting(PRIORITY_KEY, JSON.stringify(clean(patch.priorities, 'priorities')))
  return getTaskFieldConfig(store)
}
