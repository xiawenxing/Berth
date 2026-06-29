import type { Server } from 'node:http'

/**
 * Bind `server` to `preferredPort`, but if that port is already taken by ANOTHER process
 * (EADDRINUSE), fall back to an OS-assigned free port (:0). Any other listen error rejects.
 *
 * Discovery (`findReusableServer`) runs before this and reuses a live *Berth* server, so a
 * preferred-port EADDRINUSE here means a *non-Berth* process holds it — falling back to a free
 * port keeps the app/CLI launchable. Resolves to the actual bound port.
 */
export function listenWithFallback(server: Server, preferredPort: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const boundPort = () => (server.address() as { port: number } | null)?.port ?? preferredPort

    const onFirstError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        // Retry on a free port. A fresh error here is fatal.
        server.once('error', reject)
        server.listen(0, host, () => {
          server.removeListener('error', reject)
          resolve(boundPort())
        })
        return
      }
      reject(err)
    }

    server.once('error', onFirstError)
    server.listen(preferredPort, host, () => {
      server.removeListener('error', onFirstError)
      resolve(boundPort())
    })
  })
}
