import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Anchor, Inbox, Folder, Settings as SettingsIcon, Plus, Ban, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NewProjectDialog } from './NewProjectDialog'
import { useData } from '@/lib/data'
import { useLive } from '@/lib/live'
import { api, type ApiSession } from '@/lib/api'
import { toggleMode } from '@/lib/theme'

interface ProjRow {
  id: string
  name: string
  meta: string
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
function ShipDot({ kind }: { kind: 'sail' | 'dock' | null }) {
  if (!kind) return null
  return (
    <span
      title={kind === 'sail' ? '有会话在跑' : '有未读会话'}
      className={cn(
        'h-1.5 w-1.5 flex-none rounded-full',
        kind === 'sail' ? 'bg-success' : 'bg-transparent ring-1 ring-brand',
      )}
    />
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

  // Sessions bucketed by project id, so each rail row can show its aggregate live status.
  const byProject = useMemo(() => {
    const m = new Map<string, ApiSession[]>()
    for (const s of sessions) {
      const k = s.projectId ?? '__none__'
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(s)
    }
    return m
  }, [sessions])

  // Real projects (non-archived) + counts derived from tasks/sessions.
  const projects = useMemo<ProjRow[]>(() => {
    const real = apiProjects
      .filter((p) => !p.archived)
      .map((p) => {
        const tN = tasks.filter((t) => t.projectId === p.id).length
        const sN = sessions.filter((s) => s.projectId === p.id).length
        return { id: p.id, name: p.name, meta: `${tN} 任务 · ${sN} 会话` }
      })
    return [...real, ...extra]
  }, [apiProjects, tasks, sessions, extra])

  const unassignedSessions = byProject.get('__none__') ?? []
  const unassignedN = unassignedSessions.length

  // Optimistic row + persist via POST /projects/create, then reload real data.
  const addProject = (name: string, desc = '', aiContext = true, images: string[] = []) => {
    setExtra((p) => [...p, { id: name, name, meta: '0 任务 · 0 会话' }])
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
        <NavItem to="/project/Berth" icon={Folder} label="项目" />
      </nav>

      <div className="mx-3 my-2.5 h-px bg-border" />

      <button
        onClick={() => setNewProj(true)}
        className="mx-2.5 mb-1 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-brand transition-colors hover:bg-sidebar-accent"
      >
        <Plus size={14} /> 新建项目
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <div className="px-1 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          项目
        </div>
        {projects.map((p) => (
          <NavLink
            key={p.id}
            to={`/project/${encodeURIComponent(p.id)}`}
            className={({ isActive }) =>
              cn(
                'relative block rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent',
                isActive &&
                  'bg-sidebar-accent before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-brand',
              )
            }
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-accent-foreground">{p.name}</span>
              <ShipDot kind={bucketShip(byProject.get(p.id) ?? [], live)} />
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{p.meta}</span>
          </NavLink>
        ))}

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
