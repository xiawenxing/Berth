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
  pinned?: boolean
}

export interface CwdGroup {
  cwd: string
  tag: string // 主上下文 / worktree · 第2上下文
  sessions: SessionRow[]
}

export interface CargoDir {
  path: string
  label: string
  kind: 'repo' | 'worktree' | 'scratch'
  on: boolean
}

export const SHIP_LABEL: Record<ShipStatus, string> = {
  sail: '在航',
  dock: '靠岸·待查收',
  moored: '已停泊',
}
