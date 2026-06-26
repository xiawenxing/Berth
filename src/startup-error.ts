interface ListenLikeError {
  code?: string
  syscall?: string
  address?: string
  port?: number | string
  message?: string
  stack?: string
}

function isListenLikeError(error: unknown): error is ListenLikeError {
  return typeof error === 'object' && error !== null
}

function displayHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? 'localhost' : host
}

export function formatStartupError(error: unknown): string {
  if (isListenLikeError(error) && error.code === 'EADDRINUSE') {
    const host = String(error.address || process.env.HOST || '127.0.0.1')
    const port = String(error.port || process.env.PORT || '7777')
    const nextPort = Number.isInteger(Number(port)) ? String(Number(port) + 1) : '<port>'
    return [
      `berth: ${host}:${port} is already in use.`,
      `A Berth server may already be running. Open http://${displayHost(host)}:${port}/app/ or stop the process using that port.`,
      `Check the listener: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      `Start another backend: PORT=${nextPort} npm start`,
    ].join('\n')
  }
  if (isListenLikeError(error)) return error.stack || error.message || String(error)
  return String(error)
}
