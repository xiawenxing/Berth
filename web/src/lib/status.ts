// Task status is a user-configurable ordered vocabulary (cfg.statuses, e.g. 待办/进行中/阻塞/
// 待验证/已完成/已取消). The kanban columns are generated from that list. Unlike priority (an
// ordinal ramp), statuses are SEMANTIC categories with strong conventions (done=green,
// cancelled=gray, blocked=red), so we resolve a column's dot color + icon by detecting its KIND
// from keywords — which also works for custom names the user invents, with a neutral fallback.

import { Folder, Play, Ban, Search, ListChecks, X, Circle } from 'lucide-react'

export const DEFAULT_STATUSES = ['待办', '进行中', '待评估', '已完成', '已取消']

export type StatusKind = 'todo' | 'doing' | 'blocked' | 'review' | 'done' | 'cancelled' | 'other'

/** Classify a status name (zh + en keywords). Order matters: a name like 待验证 must hit
 *  'review' before the broad 待→'todo' rule. */
export function statusKind(status: string): StatusKind {
  const v = status.trim()
  if (/取消|废弃|drop|cancel|wont/i.test(v)) return 'cancelled'
  if (/完成|已交付|交付|done|complete|closed|resolved|已发布|上线/i.test(v)) return 'done'
  if (/阻塞|挂起|暂缓|blocked|block|stuck|hold/i.test(v)) return 'blocked'
  if (/验证|评估|审核|待审|review|testing|qa/i.test(v)) return 'review'
  if (/进行|进展|开发|合并|联调|doing|progress|wip|merging/i.test(v)) return 'doing'
  if (/待办|计划|todo|backlog|new|open|待/i.test(v)) return 'todo'
  return 'other'
}

const META: Record<StatusKind, { dot: string; icon: typeof Folder }> = {
  todo: { dot: 'bg-muted-foreground', icon: Folder },
  doing: { dot: 'bg-priority', icon: Play },
  blocked: { dot: 'bg-destructive', icon: Ban },
  review: { dot: 'bg-purple', icon: Search },
  done: { dot: 'bg-success', icon: ListChecks },
  cancelled: { dot: 'bg-muted-foreground', icon: X },
  other: { dot: 'bg-brand', icon: Circle },
}

/** Dot color (Tailwind bg class) + menu icon for a status, by its detected kind. */
export function statusMeta(status: string): { dot: string; icon: typeof Folder; kind: StatusKind } {
  const kind = statusKind(status)
  return { ...META[kind], kind }
}

export const isDoneStatus = (s: string) => statusKind(s) === 'done'
export const isCancelledStatus = (s: string) => statusKind(s) === 'cancelled'

/** Which configured column a (possibly external/legacy) status belongs to: exact match, else the
 *  first configured status of the same kind, else the first column. */
export function resolveColumn(status: string, statuses: string[]): string {
  if (statuses.includes(status)) return status
  const k = statusKind(status)
  return statuses.find((s) => statusKind(s) === k) ?? statuses[0] ?? status
}
