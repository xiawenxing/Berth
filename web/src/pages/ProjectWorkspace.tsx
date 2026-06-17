import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Play, Sparkles, MoreHorizontal, Anchor } from 'lucide-react'
import { Kanban } from '@/components/workspace/Kanban'
import { SessionModule } from '@/components/workspace/SessionModule'
import { CargoDefaults } from '@/components/workspace/CargoDefaults'
import { SAMPLE_CARGO } from '@/data/sample'
import { useUI } from '@/lib/ui-store'
import { NewTaskDialog, refineTitle } from '@/components/NewTaskDialog'
import { ProjectSummaryDialog, ContextDocDrawer, type ContextDocTarget } from '@/components/AiPanels'
import { useData, relTime, shortCwd, normPriority } from '@/lib/data'
import { isDoneStatus, statusKind } from '@/lib/status'
import { useLive } from '@/lib/live'
import { api } from '@/lib/api'
import type { Task, SessionRow, CwdGroup, TaskStatus, LinkedSession } from '@/lib/types'

/**
 * Project workspace (the hub) — v7 layout: sticky header + 港湾概览,
 * then 任务(航线) kanban hero, 会话(船只) module, 默认装载 registry.
 * Data is canonical sample for now; /api wiring lands in a later phase.
 */
let taskSeq = 100

export function ProjectWorkspace() {
  const { id = '' } = useParams()
  const { openLaunch, openDrawer, newTask, setNewTask } = useUI()
  const { projects, tasks: apiTasks, sessions, statuses, priorities, reload, resync } = useData()
  const live = useLive()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [ctxDoc, setCtxDoc] = useState<ContextDocTarget | null>(null)
  const [syncing, setSyncing] = useState(false)
  const doResync = () => {
    if (syncing) return
    setSyncing(true)
    resync().finally(() => setSyncing(false))
  }

  const project = projects.find((p) => p.id === id)
  const projName = project?.name ?? id

  // Real tasks for this project → board cards.
  const realTasks = useMemo<Task[]>(
    () =>
      apiTasks
        .filter((t) => t.projectId === id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status, // raw configured status; Kanban resolves it to a column
          priority: normPriority(t.priority),
          summary: t.progress ?? undefined,
          ddl: t.ddl ?? undefined,
          links: [],
        })),
    [apiTasks, id],
  )
  const [tasks, setTasks] = useState<Task[]>(realTasks)
  useEffect(() => setTasks(realTasks), [realTasks])

  // Resolve each task's linked session IDs (ApiTask.sessions) to real sessions for the card's
  // expansion. Kept SEPARATE from the editable `tasks` state so live-status ticks refresh links
  // without clobbering optimistic status/priority edits. Unresolved ids (deleted/unimported) skip.
  const sessById = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions])
  const linksByTask = useMemo(() => {
    const m = new Map<string, LinkedSession[]>()
    for (const t of apiTasks) {
      if (t.projectId !== id || !t.sessions?.length) continue
      const ls: LinkedSession[] = []
      for (const sid of t.sessions) {
        const s = sessById.get(sid)
        if (s) ls.push({ id: s.sessionId, cli: s.cli, title: s.title || '(未命名会话)', status: live.shipStatus(s.sessionId, s.updatedAt) })
      }
      if (ls.length) m.set(t.id, ls)
    }
    return m
  }, [apiTasks, id, sessById, live.rev])
  const boardTasks = useMemo(() => tasks.map((t) => ({ ...t, links: linksByTask.get(t.id) ?? [] })), [tasks, linksByTask])

  // Real sessions for this project → Pin section + by-cwd groups.
  const projSessions = useMemo(() => sessions.filter((s) => s.projectId === id), [sessions, id])
  const toRow = (s: (typeof projSessions)[number], pinned: boolean): SessionRow => ({
    id: s.sessionId,
    cli: s.cli,
    title: s.title || '(未命名)',
    cwd: shortCwd(s.cwd),
    time: relTime(s.updatedAt),
    status: live.shipStatus(s.sessionId, s.updatedAt),
    linkedTask: !!s.todoKey,
    pinned,
  })
  const pin: SessionRow[] = useMemo(
    () => projSessions.filter((s) => s.pinned).map((s) => toRow(s, true)),
    [projSessions, live.rev],
  )
  const groups: CwdGroup[] = useMemo(() => {
    const NO_CWD = '(无目录)'
    const map = new Map<string, SessionRow[]>()
    for (const s of projSessions.filter((x) => !x.pinned)) {
      const key = s.cwd || NO_CWD // RAW cwd as the stable key (display form is shortened below)
      ;(map.get(key) ?? map.set(key, []).get(key)!).push(toRow(s, false))
    }
    // The 主上下文 is the project's home cwd when it actually has sessions, else the busiest cwd.
    // Sort: main first, then by session count desc. The rest are worktree·第 N 上下文.
    const home = project?.homeCwd || project?.paths?.[0]
    const mainCwd = home && map.has(home) ? home : [...map.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
    const sorted = [...map.entries()].sort((a, b) => {
      if (a[0] === mainCwd) return -1
      if (b[0] === mainCwd) return 1
      return b[1].length - a[1].length
    })
    let worktreeN = 1
    return sorted.map(([cwd, rows]) => {
      const isMain = cwd === mainCwd
      const n = isMain ? 0 : ++worktreeN // worktrees count from 2 (主 is the 1st context)
      return {
        key: cwd,
        cwd: cwd === NO_CWD ? NO_CWD : shortCwd(cwd),
        tag: isMain ? '主上下文' : `worktree · 第 ${n} 上下文`,
        shortTag: isMain ? '主上下文' : `worktree·${n}`,
        sessions: rows,
      }
    })
  }, [projSessions, project, live.rev])

  const done = tasks.filter((t) => isDoneStatus(t.status)).length
  const total = tasks.length || 1
  const inProgress = tasks.filter((t) => statusKind(t.status) === 'doing').length
  const pct = Math.round((done / total) * 100)

  // 港湾概览 + 最近活动, derived from real sessions/tasks.
  const sailN = projSessions.filter((s) => live.shipStatus(s.sessionId, s.updatedAt) === 'sail').length
  const dockN = projSessions.filter((s) => live.shipStatus(s.sessionId, s.updatedAt) === 'dock').length
  const todayISO = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const todayTasks = apiTasks.filter((t) => t.projectId === id && t.ddl === todayISO)
  const todayDone = todayTasks.filter((t) => isDoneStatus(t.status)).length
  const lastActivity = projSessions.length ? relTime(Math.max(...projSessions.map((s) => s.updatedAt))) : '—'

  // Resolve a real absolute cwd for a fresh launch: project home / a registered path /
  // the most common cwd among this project's sessions.
  const resolveCwd = (): string => {
    if (project?.homeCwd) return project.homeCwd
    if (project?.paths?.length) return project.paths[0]
    const counts = new Map<string, number>()
    for (const s of projSessions) if (s.cwd) counts.set(s.cwd, (counts.get(s.cwd) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }
  const launch = (t: string) => {
    const cwd = resolveCwd()
    const todoKey = t ? apiTasks.find((x) => x.projectId === id && x.title === t)?.id : undefined
    openLaunch(t ? { dest: 'task', taskTitle: t, projectId: id, cwd, todoKey } : { dest: 'free', projectId: id, cwd })
  }
  // Open a real session → attach its live /pty terminal in the drawer; mark it seen.
  const openRow = (s: SessionRow) => {
    live.markSeen(s.id)
    openDrawer({ title: s.title, cli: s.cli, cwd: s.cwd, status: s.status === 'idle' ? 'moored' : s.status, sessionId: s.id })
  }
  // From a task mini-row (title only, for a not-yet-created session) → chat preview stub.
  const openSession = (t: string) => openDrawer({ title: t, cli: 'claude', cwd: '~/Code/berth', status: 'sail' })
  // From a task's expanded linked-session row → open the REAL session by id (markSeen + live pty).
  const openLinkedSession = (l: LinkedSession) => {
    const s = sessById.get(l.id)
    if (!s) return openDrawer({ title: l.title, cli: l.cli, cwd: '', status: l.status })
    live.markSeen(s.sessionId)
    openDrawer({ title: s.title || l.title, cli: s.cli, cwd: shortCwd(s.cwd), status: live.shipStatus(s.sessionId, s.updatedAt), sessionId: s.sessionId })
  }

  // Drag-to-status：optimistic move NOW, persist via PATCH /todos, then reload.
  const onMove = (taskId: string, status: TaskStatus) => {
    setTasks((ts) => ts.map((t) => (t.id === taskId && t.status !== status ? { ...t, status } : t)))
    api
      .patchTask(taskId, { status })
      .then(() => reload())
      .catch(() => reload())
  }

  // Pin toggle：persist via POST /pin, then reload (re-derives pin section vs groups).
  const onPin = (sessionId: string, on: boolean) => {
    api
      .pin(sessionId, on)
      .then(() => reload())
      .catch(() => reload())
  }

  // ⋯ task-menu actions: optimistic local edit NOW, persist via PATCH/DELETE, then reload.
  const onSetPriority = (taskId: string, priority: Task['priority']) => {
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, priority } : t)))
    api
      .patchTask(taskId, { priority })
      .then(() => reload())
      .catch(() => reload())
  }
  const onRename = (taskId: string, title: string) => {
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, title } : t)))
    api
      .patchTask(taskId, { title })
      .then(() => reload())
      .catch(() => reload())
  }
  const onDelete = (taskId: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== taskId))
    api
      .deleteTask(taskId)
      .then(() => reload())
      .catch(() => reload())
  }

  // 即时创建：optimistic card NOW, persist via POST /todos, then reload real data.
  // (The server's createTask guard already classifies + titles; AI-summarize is that pipeline.)
  const createTask = (raw: string, opts: { aiSummarize: boolean; runNow: boolean }) => {
    const tid = `new-${++taskSeq}`
    // Optimistic card uses the configured vocab (server settles to cfg defaults on reload):
    // runNow → first doing-kind status (else the 2nd column), else the first column; lowest priority.
    const todoStatus = statuses[0] ?? '待办'
    const doingStatus = statuses.find((s) => statusKind(s) === 'doing') ?? statuses[1] ?? todoStatus
    const card: Task = {
      id: tid,
      title: raw,
      status: opts.runNow ? doingStatus : todoStatus,
      priority: priorities[priorities.length - 1] ?? 'P2',
      summary: opts.aiSummarize ? '港务助手正在总结进展摘要…' : undefined,
      links: [],
    }
    setTasks((ts) => [card, ...ts])
    if (opts.runNow) openSession(raw)
    api
      .createTask(raw, id)
      .then(() => reload())
      .catch(() => {
        // keep the optimistic card but settle its title locally if the POST failed
        const { title, summary } = refineTitle(raw)
        setTasks((ts) => ts.map((t) => (t.id === tid ? { ...t, title, summary } : t)))
      })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[17px] font-bold text-foreground">{projName}</h1>
            {project?.homeCwd && <span className="font-mono text-[12px] text-muted-foreground">{shortCwd(project.homeCwd)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewTask(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-foreground"
            >
              <Plus size={14} /> 新建任务
            </button>
            <HBtn icon={<Play size={13} />} onClick={() => launch('')}>起会话</HBtn>
            <HBtn icon={<Sparkles size={13} />} onClick={() => setSummaryOpen(true)}>小结</HBtn>
            <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent">
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* rollup */}
        <div className="mt-2.5 flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>
            任务进展 <span className="font-semibold text-foreground">{done}/{total}</span>
          </span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <span>{pct}%</span>
          <span className="ml-2">进行中 <span className="font-semibold text-priority">{inProgress}</span></span>
          <span className="ml-2">最近活动 <span className="text-foreground">{lastActivity}</span></span>
        </div>

        {/* 港湾概览 */}
        <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
          <Anchor size={14} className="text-brand" />
          <span className="text-[12px] font-semibold text-foreground">港湾概览</span>
          <Pill tone="success">在跑 {sailN}</Pill>
          <Pill tone="brand">靠岸·待查收 {dockN}</Pill>
          <Pill tone="warning">今日交付 {todayDone}/{todayTasks.length}</Pill>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        {/* 任务 — hero */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-brand">任务</h2>
            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10.5px] font-medium text-brand">航线</span>
          </div>
          <Kanban
            tasks={boardTasks}
            onLaunch={launch}
            onOpenSession={openLinkedSession}
            onMove={onMove}
            onSetPriority={onSetPriority}
            onRename={onRename}
            onDelete={onDelete}
          />
        </section>

        <SessionModule pin={pin} groups={groups} onLaunch={() => launch('')} onResync={doResync} syncing={syncing} onOpen={openRow} onPin={onPin} />
        <CargoDefaults dirs={SAMPLE_CARGO} projectId={id} projectName={projName} onOpenDoc={setCtxDoc} onDone={reload} />
      </div>

      <NewTaskDialog open={newTask} onClose={() => setNewTask(false)} onCreate={createTask} />
      <ProjectSummaryDialog open={summaryOpen} onClose={() => setSummaryOpen(false)} projectId={id} />
      <ContextDocDrawer target={ctxDoc} onClose={() => setCtxDoc(null)} />
    </div>
  )
}

function HBtn({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent">
      {icon}
      {children}
    </button>
  )
}

function Pill({ children, tone }: { children: ReactNode; tone: 'success' | 'brand' | 'warning' }) {
  const dot = tone === 'success' ? 'bg-success' : tone === 'brand' ? 'bg-brand' : 'bg-warning'
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}
