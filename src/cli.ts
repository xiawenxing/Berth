import { spawn } from 'node:child_process'

export interface CliArgs {
  command: 'start' | 'help' | 'version'
  port: number | undefined
  host: string | undefined
  open: boolean
}

/**
 * Pure argv parser for the `berth` CLI. Side-effect-free so it can be unit-tested; the runner below
 * consumes the result. Accepts: `berth [start] [--port N] [--host H] [--open|--no-open]`,
 * `berth --help|-h`, `berth --version`.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: 'start', port: undefined, host: undefined, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h' || a === 'help') out.command = 'help'
    else if (a === '--version' || a === '-v' || a === 'version') out.command = 'version'
    else if (a === 'start') out.command = 'start'
    else if (a === '--open') out.open = true
    else if (a === '--no-open') out.open = false
    else if (a === '--port') {
      const v = Number(argv[++i])
      if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`invalid --port: ${argv[i]}`)
      out.port = v
    } else if (a === '--host') {
      out.host = argv[++i]
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return out
}

const HELP = `berth — agent-session cockpit

Usage:
  berth start [options]   Start the local server and open the UI in your browser
  berth --help            Show this help
  berth --version         Show the version

Options:
  --port <n>     Port to listen on (default 7777, or $PORT)
  --host <h>     Host to bind (default 127.0.0.1; use 0.0.0.0 to expose on your LAN — unsafe)
  --no-open      Do not open the browser automatically

State lives in ~/.berth (sqlite + docs). The server is single-user and unauthenticated; keep it on
loopback. See the README for optional integrations (e.g. Feishu).`

/** Best-effort cross-platform browser open. Never throws (a failed open must not crash the server). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref() } catch { /* ignore */ }
}

/** CLI entry. Kept thin: parse, then dispatch. Imports the server lazily so --help/--version are instant. */
export async function runCli(argv: string[], version: string): Promise<void> {
  let args: CliArgs
  try { args = parseCliArgs(argv) } catch (e: any) { console.error(`berth: ${e.message}\n`); console.error(HELP); process.exit(2); return }

  if (args.command === 'help') { console.log(HELP); return }
  if (args.command === 'version') { console.log(version); return }

  const { start } = await import('./server/index')
  const host = args.host ?? process.env.HOST ?? '127.0.0.1'
  const { port } = await start(args.port, host)
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
  if (args.open) openBrowser(url)
}
