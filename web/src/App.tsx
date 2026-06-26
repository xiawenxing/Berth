import { createHashRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom'
import { Rail } from './components/Rail'
import { useData } from './lib/data'
import { ProjectWorkspace } from './pages/ProjectWorkspace'
import { Now } from './pages/Now'
import { Unassigned } from './pages/Unassigned'
import { Settings } from './pages/Settings'
import { UIProvider } from './lib/ui-store'
import { DataProvider } from './lib/data'
import { LiveProvider } from './lib/live'
import { SessionDrawer } from './components/SessionDrawer'
import { LaunchDialog } from './components/LaunchDialog'

function Layout() {
  return (
    <DataProvider>
      <LiveProvider>
      <UIProvider>
        <div className="flex h-full w-full overflow-hidden">
          <Rail />
          <main className="min-w-0 flex-1 overflow-hidden bg-background">
            <Outlet />
          </main>
        </div>
        {/* app-wide overlays */}
        <SessionDrawer />
        <LaunchDialog />
      </UIProvider>
      </LiveProvider>
    </DataProvider>
  )
}

function Home() {
  const { projects, loading } = useData()
  if (loading) return <div className="p-6 text-[12px] text-muted-foreground">加载中…</div>
  const first = projects.find((p) => !p.archived)
  return <Navigate to={first ? `/project/${encodeURIComponent(first.id)}` : '/now'} replace />
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/now', element: <Now /> },
      { path: '/project/:id', element: <ProjectWorkspace /> },
      { path: '/unassigned', element: <Unassigned /> },
      { path: '/settings', element: <Settings /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
