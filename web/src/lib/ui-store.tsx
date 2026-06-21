import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

// Minimal app-wide UI state: which session drawer is open, whether the launch
// dialog / new-task / new-project dialogs are open. Keeps overlays out of page trees.

export interface LaunchSpec {
  cli: string
  cwd: string
  launchToken?: string
  projectId?: string | null
  todoKey?: string | null
  prompt?: string
  images?: { name: string; dataUrl: string }[]
}

export interface DrawerSession {
  title: string
  cli: string
  cwd: string
  status: 'sail' | 'dock' | 'moored'
  task?: string
  sessionId?: string // real session → attach the live /pty terminal
  launch?: LaunchSpec // fresh launch → spawn a new agent via /pty?new=1
}

export interface LaunchCtx {
  dest: 'task' | 'free'
  taskTitle?: string
  projectId?: string
  todoKey?: string
}

interface UIState {
  drawer: DrawerSession | null
  launch: LaunchCtx | null
  newTask: boolean
  newProject: boolean
  openDrawer: (s: DrawerSession) => void
  closeDrawer: () => void
  openLaunch: (c: LaunchCtx) => void
  closeLaunch: () => void
  setNewTask: (v: boolean) => void
  setNewProject: (v: boolean) => void
}

const Ctx = createContext<UIState | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<DrawerSession | null>(null)
  const [launch, setLaunch] = useState<LaunchCtx | null>(null)
  const [newTask, setNewTask] = useState(false)
  const [newProject, setNewProject] = useState(false)

  const value: UIState = {
    drawer,
    launch,
    newTask,
    newProject,
    openDrawer: useCallback((s: DrawerSession) => setDrawer(s), []),
    closeDrawer: useCallback(() => setDrawer(null), []),
    openLaunch: useCallback((c: LaunchCtx) => setLaunch(c), []),
    closeLaunch: useCallback(() => setLaunch(null), []),
    setNewTask,
    setNewProject,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUI(): UIState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useUI must be used within UIProvider')
  return v
}
