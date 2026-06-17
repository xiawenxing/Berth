// Canonical sample data for the Berth project workspace (matches
// docs/mockups/berth-2.0/v7-project.html). Used until /api wiring lands.

import type { Task, CwdGroup, CargoDir, SessionRow } from '@/lib/types'

export const SAMPLE_TASKS: Task[] = [
  { id: 't1', title: '项目页直接进工作台(废弃导览页)', status: '待办', priority: 'P1' },
  { id: 't2', title: '无归属会话归并入口', status: '待办', priority: 'P2' },
  { id: 't3', title: 'Now 改造为跨项目收件箱', status: '待办', priority: 'P2', ddl: '明天' },
  {
    id: 't4',
    title: '会话列表改为 pin + cwd 分组',
    status: '进行中',
    priority: 'P1',
    ddl: '今日',
    summary: '已确定砍掉活跃/已归档，改为 pin + 按 cwd 分组；正产出融合稿。',
    links: [
      { id: 'ls1', cli: 'claude', title: 'Berth 2.0 交互重构讨论', status: 'sail' },
      { id: 'ls2', cli: 'codex', title: '数据层解耦 review', status: 'dock' },
    ],
  },
  {
    id: 't5',
    title: '废弃全部会话页',
    status: '进行中',
    priority: 'P0',
    ddl: '今日',
    summary: '先把 无归属/导入/搜索 搬家再删 tab。',
    links: [{ id: 'ls3', cli: 'claude', title: 'trust dialog 预置', status: 'moored' }],
  },
  {
    id: 't6',
    title: 'show-more 移植到会话模块',
    status: '进行中',
    priority: 'P2',
    summary: '让长 cwd 分组可折叠。',
    links: [{ id: 'ls4', cli: 'codex', title: 'writeQueue 单测', status: 'moored' }],
  },
  {
    id: 't7',
    title: '任务上下文沉淀格式',
    status: '待评估',
    priority: 'P2',
    summary: '评估会话结果如何沉淀回任务。',
    links: [],
  },
  { id: 't8', title: '数据层解耦', status: '已完成', priority: 'P1' },
  { id: 't9', title: '上下文管理 Phase1', status: '已完成', priority: 'P2' },
  { id: 't10', title: '持久化 PTY 模型', status: '已完成', priority: 'P1' },
  { id: 't11', title: '设计令牌迁移', status: '已完成', priority: 'P2' },
  { id: 't12', title: 'codex hook trust', status: '已完成', priority: 'P1', ddl: '今日' },
  { id: 't13', title: '多端实时同步(暂缓)', status: '已取消', priority: 'P2' },
]

export const SAMPLE_PIN: SessionRow[] = [
  { id: 'p1', cli: 'claude', title: 'Berth 2.0 交互重构讨论', cwd: '~/Code/berth', time: '12分钟前', status: 'sail' },
  { id: 'p2', cli: 'codex', title: '数据层解耦 review', cwd: '~/Code/berth', time: '1小时前', status: 'dock' },
]

export const SAMPLE_CWD_GROUPS: CwdGroup[] = [
  {
    key: '~/Code/berth',
    cwd: '~/Code/berth',
    tag: '主上下文',
    shortTag: '主上下文',
    sessions: [
      { id: 's1', cli: 'claude', title: '修复 pty 重连丢失滚动', cwd: '~/Code/berth', time: '2小时前', status: 'moored' },
      { id: 's2', cli: 'codex', title: 'reconcile.ts 绑定调试', cwd: '~/Code/berth', time: '3小时前', status: 'moored' },
      { id: 's3', cli: 'claude', title: 'trust dialog 预置', cwd: '~/Code/berth', time: '5小时前', status: 'moored', linkedTask: true },
      { id: 's4', cli: 'coco', title: 'lucide sprite 构建', cwd: '~/Code/berth', time: '昨天', status: 'moored' },
      { id: 's5', cli: 'claude', title: 'manifest 静默注入', cwd: '~/Code/berth', time: '2天前', status: 'moored' },
    ],
  },
  {
    key: '~/Code/berth-i18n',
    cwd: '~/Code/berth-i18n',
    tag: 'worktree · 第 2 上下文',
    shortTag: 'worktree·2',
    sessions: [
      { id: 's6', cli: 'coco', title: 'i18n 文案抽取', cwd: '~/Code/berth-i18n', time: '昨天', status: 'moored' },
      { id: 's7', cli: 'codex', title: 'writeQueue 单测', cwd: '~/Code/berth-i18n', time: '3天前', status: 'moored', linkedTask: true },
    ],
  },
]

export const SAMPLE_CARGO: CargoDir[] = [
  { path: '~/Code/berth', label: '主仓库', kind: 'repo', on: true },
  { path: '~/Code/berth-i18n', label: 'worktree · feat/i18n', kind: 'worktree', on: true },
  { path: '~/.berth/scratch', label: '默认cwd · 非编程任务', kind: 'scratch', on: false },
]
