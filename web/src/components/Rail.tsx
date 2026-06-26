import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Anchor, Inbox, Settings as SettingsIcon, Plus, Ban, Sun, Moon, Archive, ChevronRight, CalendarClock } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { NewProjectDialog } from './NewProjectDialog'
import { useData } from '@/lib/data'
import { useLive } from '@/lib/live'
import { api, type ApiSession } from '@/lib/api'
import { toggleMode } from '@/lib/theme'
import { deliveryStats } from '@/lib/delivery'

interface ProjRow {
  id: string
  name: string
  meta: string
  deliveryCount?: number
  archived?: boolean
}

/** Aggregate live status for a bucket of sessions: 'sail' if any is running, else 'dock' if any is
 *  unread (settled & newer than last-seen), else null. Mirrors the ShipGlyph priority (sail > dock). */
function bucketShip(sessions: ApiSession[], live: ReturnType<typeof useLive>): 'sail' | 'dock' | null {
  let dock = false
  for (const s of sessions) {
    const st = live.shipStatus(s.sessionId, s.updatedAt)
    if (st === 'sail') return 'sail'
    if (st === 'dock') dock = true
  }
  return dock ? 'dock' : null
}

/** The little nav-row status dot, same visual language as Now/Unassigned/TaskCard ShipGlyph. */
function ShipDot({ kind, count }: { kind: 'sail' | 'dock' | 'delivery' | null; count?: number }) {
  if (!kind) return null
  // sail=运行中(蓝色 loading), dock=未读(红点) — mirrors the session-list lamp.
  if (kind === 'sail') return <Spinner size={11} className="text-brand" label="有会话在跑" />
  if (kind === 'dock') return <span title="有未读会话" className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" />
  return (
    <span title={`今日交付 ${count ?? 0}`} className="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-warning/15 px-1 text-[10px] font-semibold text-warning">
      <CalendarClock size={10} />
      {(count ?? 0) > 1 && <span className="ml-0.5">{count}</span>}
    </span>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => setDark(toggleMode().mode === 'dark')
  return (
    <button onClick={toggle} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" title="切换日间/夜间">
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

function NavItem({ to, icon: Icon, label }: { to: string; icon: typeof Inbox; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          isActive && 'bg-sidebar-accent font-semibold text-accent-foreground before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-brand',
        )
      }
    >
      <Icon size={15} />
      {label}
    </NavLink>
  )
}

export function Rail() {
  const { projects: apiProjects, tasks, sessions, reload } = useData()
  const live = useLive()
  const [extra, setExtra] = useState<ProjRow[]>([])
  const [newProj, setNewProj] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)

  // Sessions bucketed by project id, so each rail row can show its aggregate live status.
  const byProject = useMemo(() => {
    const m = new Map<string, ApiSession[]>()
    for (const s of sessions) {
      const k = s.projectId ?? '__none__'
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(s)
    }
    return m
  }, [sessions])

  const rowForProject = (p: (typeof apiProjects)[number]): ProjRow => {
    const projectTasks = tasks.filter((t) => t.projectId === p.id)
    const tN = projectTasks.length
    const sN = sessions.filter((s) => s.projectId === p.id).length
    return { id: p.id, name: p.name, meta: `${tN} 任务 · ${sN} 会话`, deliveryCount: deliveryStats(projectTasks).total, archived: p.archived }
  }

  // Real active projects + optimistic newly-created rows.
  const projects = useMemo<ProjRow[]>(() => {
    const real = apiProjects
      .filter((p) => !p.archived)
      .map(rowForProject)
    return [...real, ...extra]
  }, [apiProjects, tasks, sessions, extra])
  const archivedProjects = useMemo<ProjRow[]>(
    () => apiProjects.filter((p) => p.archived).map(rowForProject),
    [apiProjects, tasks, sessions],
  )

  const unassignedSessions = byProject.get('__none__') ?? []
  const unassignedN = unassignedSessions.length

  // Optimistic row + persist via POST /projects/create, then reload real data.
  const addProject = (name: string, desc = '', aiContext = true, images: string[] = []) => {
    setExtra((p) => [...p, { id: name, name, meta: '0 任务 · 0 会话', deliveryCount: 0 }])
    api
      .createProject(name)
      .then((created: { id?: string; name?: string }) => {
        const projectName = created.name || name
        if ((aiContext || images.length) && (desc.trim() || images.length)) {
          return api.contextUpdate('project', projectName, desc.trim(), images).catch(() => {}).then(() => created)
        }
        return created
      })
      .then(() => { setExtra([]); reload() })
      .catch(() => {})
  }

  return (
    <aside className="flex w-[260px] flex-none flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 px-3.5 py-3 text-[14px] font-bold">
        <Anchor size={18} className="text-brand" />
        Berth
        <ThemeToggle />
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5">
        <NavItem to="/now" icon={Inbox} label="Now" />
      </nav>

      <div className="mx-3 my-2.5 h-px bg-border" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {/* Section header owns the create-action: a quiet ＋ on the right, so 新建项目 reads as part of
            this section instead of a loud brand button floating above it (which out-shouted the list). */}
        <div className="flex items-center px-1 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>项目</span>
          <button
            type="button"
            onClick={() => setNewProj(true)}
            title="新建项目"
            className="ml-auto flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-brand"
          >
            <Plus size={14} />
          </button>
        </div>
        {projects.map((p) => (
          <ProjectNavRow key={p.id} project={p} ship={bucketShip(byProject.get(p.id) ?? [], live)} />
        ))}

        {archivedProjects.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-1 pb-1 pt-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              aria-expanded={archivedOpen}
            >
              <ChevronRight size={12} className={cn('transition-transform', archivedOpen && 'rotate-90')} />
              <Archive size={12} />
              已归档
              <span className="ml-auto rounded-full bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">{archivedProjects.length}</span>
            </button>
            {archivedOpen &&
              archivedProjects.map((p) => (
                <ProjectNavRow key={p.id} project={p} ship={bucketShip(byProject.get(p.id) ?? [], live)} />
              ))}
          </div>
        )}

        <NavLink
          to="/unassigned"
          className={({ isActive }) =>
            cn(
              'mt-2 flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-sidebar-accent',
              isActive && 'border-brand text-foreground',
            )
          }
        >
          <Ban size={13} /> 无归属会话
          <ShipDot kind={bucketShip(unassignedSessions, live)} />
          <span className="ml-auto">{unassignedN}</span>
        </NavLink>
      </div>

      <div className="mt-auto border-t border-border px-2.5 py-1.5">
        <NavItem to="/settings" icon={SettingsIcon} label="设置" />
      </div>

      <NewProjectDialog open={newProj} onClose={() => setNewProj(false)} onCreate={addProject} />
    </aside>
  )
}

function ProjectNavRow({ project, ship }: { project: ProjRow; ship: 'sail' | 'dock' | null }) {
  const signal = ship ?? ((project.deliveryCount ?? 0) > 0 ? 'delivery' : null)
  return (
    <NavLink
      to={`/project/${encodeURIComponent(project.id)}`}
      className={({ isActive }) =>
        cn(
          'relative block rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent',
          project.archived && 'opacity-75',
          isActive &&
            'bg-sidebar-accent opacity-100 before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-brand',
        )
      }
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-accent-foreground" title={project.name}>{project.name}</span>
        {project.archived && <Archive size={11} className="flex-none text-muted-foreground" />}
        <ShipDot kind={signal} count={project.deliveryCount} />
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{project.meta}</span>
    </NavLink>
  )
}
