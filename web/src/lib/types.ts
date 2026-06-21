// Domain types for the workspace (v7). Mirrors the canonical mockup data;
// refined against /api shapes as real data is wired in.

// Priority is whatever the user configured in Settings (ordered list, high→low). Kept loose so
// custom vocabularies flow through; color/order come from the list's rank (see lib/priority.ts).
export type Priority = string
// Status, like Priority, is a user-configurable vocabulary (ordered list from Settings). Kept
// loose; the kanban columns + dot/icon come from that list (see lib/status.ts, lib/data.tsx).
export type TaskStatus = string
export type ShipStatus = 'sail' | 'dock' | 'moored' // 在航 / 靠岸·待查收 / 已停泊

export interface LinkedSession {
  id: string // real session id — lets the card open the actual session (not a title stub)
  cli: string
  title: string
  status: ShipStatus
}

export interface Task {
  id: string
  title: string
  status: TaskStatus
  priority: Priority
  summary?: string
  summarizing?: boolean // 港务助手 is (re)generating this task's 进展摘要 — drives the loading icon
  ddl?: string | null // '今日' | '明天' | 'M/D' | '逾期 N天' | null
  links?: LinkedSession[]
}

export interface SessionRow {
  id: string
  cli: string
  title: string
  cwd: string
  time: string
  status: ShipStatus | 'idle'
  linkedTask?: boolean
  taskId?: string | null
  pinned?: boolean
}

export interface CwdGroup {
  key: string // stable React key — the RAW cwd (cwd is the shortened display form, can collide)
  cwd: string // display form (shortCwd) — for kind:'workspace' this is the masked label, not a path
  tag: string // full tag for the right-side pill: 主上下文 / worktree · 第 2 上下文
  shortTag: string // compact inline label suffix: 主上下文 / worktree·2
  sessions: SessionRow[]
  kind?: 'workspace' | 'cwd' // 'workspace' = Berth-assigned default dir (masked label)
  rawCwd?: string // the real absolute cwd, for the import-icon's previewDir (present on every group)
}

export const SHIP_LABEL: Record<ShipStatus, string> = {
  sail: '在航',
  dock: '靠岸·待查收',
  moored: '已停泊',
}
