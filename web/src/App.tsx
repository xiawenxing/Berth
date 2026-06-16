import { createHashRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom'
import { Rail } from './components/Rail'
import { ProjectWorkspace } from './pages/ProjectWorkspace'
import { Now } from './pages/Now'
import { Unassigned } from './pages/Unassigned'
import { Settings } from './pages/Settings'

function Layout() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <Rail />
      <main className="min-w-0 flex-1 overflow-hidden bg-background">
        <Outlet />
      </main>
    </div>
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
