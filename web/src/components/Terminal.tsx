import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export interface LaunchSpec {
  cli: string
  cwd: string
  launchToken?: string
  projectId?: string | null
  todoKey?: string | null
  prompt?: string
}

/**
 * Live terminal over the persistent-PTY /pty WebSocket. Two modes:
 *  - resume/attach: pass `sessionId` → /pty?sessionId=… (replays scrollback, streams)
 *  - fresh launch:  pass `launch` → /pty?new=1&cli=…&cwd=… (spawns a new agent); the
 *    server's first control frame {"__berth":"launched",sessionId} gives the real id,
 *    surfaced via onLaunched so callers can rebind the drawer to the live session.
 */
export function Terminal({
  sessionId,
  launch,
  onLaunched,
  initialInput,
}: {
  sessionId?: string
  launch?: LaunchSpec
  onLaunched?: (sessionId: string) => void
  /** When resuming (sessionId mode), text submitted to the agent once, after the ws opens. */
  initialInput?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
      theme: { background: '#0d1220', foreground: '#b3bcd4', cursor: '#56b6ff' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    // Focus so keyboard input (arrow keys, Ctrl-C, …) goes to the pty, not the page.
    term.focus()
    const refocus = () => term.focus()
    host.addEventListener('mousedown', refocus)

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const qs = new URLSearchParams({ cols: String(term.cols), rows: String(term.rows) })
    if (launch) {
      qs.set('new', '1')
      qs.set('cli', launch.cli)
      qs.set('cwd', launch.cwd)
      if (launch.launchToken) qs.set('launchToken', launch.launchToken)
      if (launch.projectId) qs.set('projectId', launch.projectId)
      if (launch.todoKey) qs.set('todoKey', launch.todoKey)
      if (launch.prompt) qs.set('prompt', launch.prompt)
    } else if (sessionId) {
      qs.set('sessionId', sessionId)
    }
    const ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
    ws.binaryType = 'arraybuffer'
    // Resume + auto-submit: when resuming a session with an initial message, send it once the
    // pty socket is open, followed by a carriage return so the agent receives + runs it.
    const sendInput = (d: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
    }
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }))
    }

    if (sessionId && !launch && initialInput) {
      ws.addEventListener('open', () => {
        sendInput(initialInput)
        sendInput('\r')
      }, { once: true })
    }
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
      if (data.startsWith('{"__berth"')) {
        try {
          const ctl = JSON.parse(data)
          if (ctl.__berth === 'launched' && ctl.sessionId) onLaunched?.(ctl.sessionId)
          return // a well-formed control frame is not terminal output
        } catch {
          // not actually a control frame (e.g. pty output that happens to start
          // with that text, or a split chunk) — fall through and render it.
        }
      }
      term.write(data)
    }
    const disp = term.onData((d) => {
      sendInput(d)
    })

    const onResize = () => {
      fit.fit()
      sendResize()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      host.removeEventListener('mousedown', refocus)
      disp.dispose()
      ws.close()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, initialInput, launch?.cli, launch?.cwd, launch?.launchToken, launch?.prompt, launch?.projectId, launch?.todoKey])

  return <div ref={hostRef} className="h-full w-full" />
}
