// Domain types for the workspace (v7). Mirrors the canonical mockup data;
// refined against /api shapes as real data is wired in.

export type Priority = 'P0' | 'P1' | 'P2'
export type TaskStatus = '待办' | '进行中' | '待评估' | '已完成' | '已取消'
export type ShipStatus = 'sail' | 'dock' | 'moored' // 在航 / 靠岸·待查收 / 已停泊

export const STATUS_ORDER: TaskStatus[] = ['待办', '进行中', '待评估', '已完成', '已取消']

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
