import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * Live terminal bound to a session over the persistent-PTY /pty WebSocket.
 * Skeleton: attaches, streams pty bytes, sends keystrokes. The control-frame
 * protocol ({"__berth":…}) and resize messages are refined in a later phase.
 */
export function Terminal({ sessionId }: { sessionId: string }) {
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

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/pty?sessionId=${encodeURIComponent(sessionId)}`)
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
      if (data.startsWith('{"__berth"')) return // control frame — handled later
      term.write(data)
    }
    const disp = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d)
    })

    const onResize = () => fit.fit()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      disp.dispose()
      ws.close()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={hostRef} className="h-full w-full" />
}
