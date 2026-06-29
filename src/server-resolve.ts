import { readServerFile, type ServerAddress } from './server-discovery'

/** Normalize a bind host to something connectable (0.0.0.0/:: → loopback). */
function connectHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

/** True iff a Berth server answers `/api/health` with `{berth:true}` at host:port. Never throws. */
export async function probeHealth(
  host: string,
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await fetchImpl(`http://${connectHost(host)}:${port}/api/health`)
    return r.ok && (await r.json())?.berth === true
  } catch {
    return false
  }
}

export interface ResolveDeps {
  read?: () => ServerAddress | null
  probe?: (host: string, port: number) => Promise<boolean>
}

/**
 * Find a reusable, already-running Berth server so the second of {app, CLI} to start never spawns a
 * duplicate. Checks the recorded `server.json` address first (ANY port — this is what fixes the
 * "app on :58128, CLI binds a second server on :7777" split), then the preferred port as a fallback
 * for when the record is missing or stale. Returns the reusable address, or null to bind a fresh one.
 */
export async function findReusableServer(
  preferred: { host: string; port: number },
  deps: ResolveDeps = {},
): Promise<ServerAddress | null> {
  const read = deps.read ?? readServerFile
  const probe = deps.probe ?? probeHealth

  const rec = read()
  if (rec && (await probe(rec.host, rec.port))) return rec

  // Record missing/stale: a healthy Berth server may still be on the preferred port. Skip the probe
  // when the (failed) record already pointed there — no value in probing the same port twice.
  if (!(rec && rec.port === preferred.port) && (await probe(preferred.host, preferred.port))) {
    return { host: preferred.host, port: preferred.port }
  }
  return null
}
