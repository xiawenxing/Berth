// Pure display helpers. Kept out of data.tsx so that file exports only React components/hooks —
// mixing plain functions into a component module makes @vitejs/plugin-react bail on Fast Refresh
// and force a full page reload (which also tears down the /status + /pty WebSockets on every edit).

export function relTime(epochSec: number): string {
  const s = Math.floor(Date.now() / 1000) - epochSec
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`
  if (s < 172800) return '昨天'
  if (s < 604800) return `${Math.floor(s / 86400)}天前`
  return `${Math.floor(s / 604800)}周前`
}

export function shortCwd(cwd?: string | null): string {
  if (!cwd) return ''
  const home = '/Users/'
  return cwd.startsWith(home) ? '~/' + cwd.split('/').slice(3).join('/') : cwd
}

/** Pass the configured priority through as-is (ranked/colored by its position in the Settings
 *  list, see lib/priority.ts); only fall back when the backend gives nothing. */
export function normPriority(p?: string): string {
  return p && p.trim() ? p.trim() : 'P2'
}
