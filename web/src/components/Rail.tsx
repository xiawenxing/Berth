import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Anchor, Inbox, Folder, Settings as SettingsIcon, Plus, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NewProjectDialog } from './NewProjectDialog'

// Placeholder project switcher data — wired to /api/projects in a later phase.
interface ProjRow {
  id: string
  name: string
  meta: string
  running?: boolean
  group: string
}
const INITIAL_PROJECTS: ProjRow[] = [
  { id: 'Berth', name: 'Berth', meta: '13 任务 · 3 进行中 · 7 会话', running: true, group: '置顶' },
  { id: 'berth test', name: 'berth test', meta: '0 任务 · 0 会话', group: '活跃' },
  { id: 'Zhang Shuai conversation', name: 'Zhang Shuai conversation', meta: '2 任务 · 1 会话', group: '活跃' },
  { id: 'dotfiles', name: 'dotfiles', meta: '4 任务 · 2 会话', group: '活跃' },
]

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
  const [projects, setProjects] = useState<ProjRow[]>(INITIAL_PROJECTS)
  const [newProj, setNewProj] = useState(false)

  const addProject = (name: string) => {
    setProjects((p) => [...p, { id: name, name, meta: '0 任务 · 0 会话', group: '活跃' }])
  }

  return (
    <aside className="flex w-[260px] flex-none flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 px-3.5 py-3 text-[14px] font-bold">
        <Anchor size={18} className="text-brand" />
        Berth
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
            <div className="flex items-center gap-2">
              {p.running && <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />}
              <span className="truncate text-[13px] font-medium text-accent-foreground">{p.name}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.meta}</div>
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
          <Ban size={13} /> 无归属会话 <span className="ml-auto">5</span>
        </NavLink>
      </div>

      <div className="mt-auto border-t border-border px-2.5 py-1.5">
        <NavItem to="/settings" icon={SettingsIcon} label="设置" />
      </div>

      <NewProjectDialog open={newProj} onClose={() => setNewProj(false)} onCreate={(name) => addProject(name)} />
    </aside>
  )
}
