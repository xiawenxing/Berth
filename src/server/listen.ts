import type { Server } from 'node:http'

/**
 * Bind `server` to `preferredPort`. When `allowFallback` is true and the port is already taken by
 * ANOTHER process (EADDRINUSE), fall back to an OS-assigned free port (:0). Any other listen error —
 * or an EADDRINUSE with `allowFallback` false — rejects.
 *
 * The app passes `allowFallback: true` for its defaulted 7777 so it always launches (discovery has
 * already reused a live *Berth* server, so a conflict here means a *non-Berth* holder). The CLI passes
 * `false` so an explicitly-requested `--port` that's taken surfaces as an error rather than silently
 * landing on a random port. Resolves to the actual bound port.
 */
export function listenWithFallback(
  server: Server,
  preferredPort: number,
  host: string,
  allowFallback = true,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const boundPort = () => (server.address() as { port: number } | null)?.port ?? preferredPort

    const onFirstError = (err: NodeJS.ErrnoException) => {
      if (allowFallback && err.code === 'EADDRINUSE' && preferredPort !== 0) {
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
