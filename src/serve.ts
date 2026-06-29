import type { ServerAddress } from './server-discovery'

export interface ServeDeps {
  /** Discovery: returns a reusable server address or null (defaults to findReusableServer at the call site). */
  find: (
    preferred: { host: string; port: number },
    deps?: unknown,
    opts?: { exact?: boolean },
  ) => Promise<ServerAddress | null>
  /** Bind a fresh server (defaults to the server's start() at the call site). */
  start: () => Promise<{ port: number }>
  log: (message: string) => void
  /** Env source (injectable for tests); reads PORT/HOST. */
  env?: Record<string, string | undefined>
}

/**
 * The `npm start` / `berth serve` entry's decision: reuse a Berth server that's already running
 * (whichever of app/CLI started it, on whatever port) instead of binding a second one and failing
 * with EADDRINUSE. Mirrors the `berth start` CLI's reuse so the dev server is reuse-aware too.
 *
 * An explicit PORT/HOST means "I want THIS address" → exact discovery (reuse only a server on it).
 * With neither set, reuse any recorded Berth server (bidirectional discovery).
 */
export async function serveOrReuse(deps: ServeDeps): Promise<{ reused: boolean; port: number }> {
  const env = deps.env ?? process.env
  const host = env.HOST || '127.0.0.1'
  const port = Number(env.PORT) || 7777
  const explicit = env.PORT !== undefined || env.HOST !== undefined

  const reusable = await deps.find({ host, port }, undefined, { exact: explicit })
  if (reusable) {
    const shown = reusable.host === '0.0.0.0' ? 'localhost' : reusable.host
    deps.log(`berth: 已在运行 http://${shown}:${reusable.port}/app/ — 复用现有服务，未启动新实例`)
    return { reused: true, port: reusable.port }
  }
  const { port: bound } = await deps.start()
  return { reused: false, port: bound }
}
