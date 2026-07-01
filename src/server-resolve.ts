import { readServerFile, type ServerAddress } from './server-discovery'

/** Health-probe timeout: a port that accepts the TCP connection but never answers must not hang launch. */
const PROBE_TIMEOUT_MS = 1000

/** Normalize a bind host to something connectable (0.0.0.0/:: → loopback). */
function connectHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

/** True iff a Berth server answers `/api/health` with `{berth:true}` at host:port. Never throws; a
 *  non-responding socket aborts after PROBE_TIMEOUT_MS rather than blocking the caller forever. */
export async function probeHealth(
  host: string,
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await fetchImpl(`http://${connectHost(host)}:${port}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return r.ok && (await r.json())?.berth === true
  } catch {
    return false
  }
}

export interface ResolveDeps {
  read?: () => ServerAddress | null
  probe?: (host: string, port: number) => Promise<boolean>
}

export interface ResolveOpts {
  /** Explicit host:port was requested (e.g. `berth start --port N`): reuse ONLY a server actually on
   *  that port, never a recorded server on a different port. */
  exact?: boolean
}

/**
 * Find a reusable, already-running Berth server so the second of {app, CLI} to start never spawns a
 * duplicate. In the default (non-exact) mode it reuses the recorded `server.json` address on ANY port
 * (what fixes the "app on :58128, CLI binds a second server on :7777" split), falling back to a health
 * probe of the preferred port. In `exact` mode — an explicitly requested host:port — it reuses ONLY a
 * live server on exactly that port, so `--port N` is honoured rather than silently satisfied elsewhere.
 * Returns the reusable address, or null to bind a fresh one.
 */
export async function findReusableServer(
  preferred: { host: string; port: number },
  deps: ResolveDeps = {},
  opts: ResolveOpts = {},
): Promise<ServerAddress | null> {
  const read = deps.read ?? readServerFile
  const probe = deps.probe ?? probeHealth

  if (opts.exact) {
    return (await probe(preferred.host, preferred.port)) ? { host: preferred.host, port: preferred.port } : null
  }

  const rec = read()
  if (rec && (await probe(rec.host, rec.port))) return rec

  // Record missing/stale: a healthy Berth server may still be on the preferred port. Skip the probe
  // when the (failed) record already pointed there — no value in probing the same host:port twice.
  if (!(rec && rec.port === preferred.port && rec.host === preferred.host) && (await probe(preferred.host, preferred.port))) {
    return { host: preferred.host, port: preferred.port }
  }
  return null
}
