import { createHashRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom'
import { Rail } from './components/Rail'
import { ProjectWorkspace } from './pages/ProjectWorkspace'
import { Now } from './pages/Now'
import { Unassigned } from './pages/Unassigned'
import { Settings } from './pages/Settings'
import { UIProvider } from './lib/ui-store'
import { SessionDrawer } from './components/SessionDrawer'
import { LaunchDialog } from './components/LaunchDialog'

function Layout() {
  return (
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
  )
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Navigate to="/project/Berth" replace /> },
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
