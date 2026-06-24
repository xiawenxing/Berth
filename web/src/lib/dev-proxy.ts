import type { Logger, LogErrorOptions } from 'vite'

// EPIPE / ECONNRESET on the dev proxy mean a /pty or /status WebSocket (or the upstream
// socket Vite opens to the backend) was torn down mid-flight. Every page reload, route
// change, HMR update, or backend restart does this — it's expected churn, not a fault.
// Vite's internal `proxyReqWs` handler logs each one as a scary `ws proxy socket error:`
// stack trace via `config.logger.error(msg, { error })`, so the only place we can suppress
// it is the logger. A genuine failure to reach the backend surfaces as ECONNREFUSED (we
// never connected), which is NOT in this set and still logs.
const BENIGN_PROXY_CODES = new Set(['EPIPE', 'ECONNRESET'])

export function isBenignProxyError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code != null && BENIGN_PROXY_CODES.has(code)
}

// Wrap a Vite Logger so benign proxy connection-churn errors are dropped while every other
// error still logs. Used as `customLogger` in vite.config.ts.
export function quietProxyLogger(logger: Logger): Logger {
  const error = logger.error.bind(logger)
  return {
    ...logger,
    error(msg: string, options?: LogErrorOptions) {
      if (isBenignProxyError(options?.error)) return
      error(msg, options)
    },
  }
}
