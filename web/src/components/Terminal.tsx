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
  images?: { name: string; dataUrl: string }[]
}

function cssToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function terminalTheme() {
  return {
    background: cssToken('--color-canvas', '#0d1220'),
    foreground: cssToken('--color-foreground', '#d7deef'),
    cursor: cssToken('--color-brand', '#56b6ff'),
    cursorAccent: cssToken('--color-brand-foreground', '#0d1220'),
    selectionBackground: 'rgba(86, 182, 255, 0.22)',
    black: '#101526',
    red: cssToken('--color-destructive', '#f0707f'),
    green: cssToken('--color-success', '#7ed4a6'),
    yellow: cssToken('--color-warning', '#f0c773'),
    blue: cssToken('--color-brand', '#56b6ff'),
    magenta: cssToken('--color-purple', '#b88cf0'),
    cyan: '#68d7d4',
    white: cssToken('--color-card-foreground', '#c7cfe3'),
    brightBlack: cssToken('--color-muted-foreground', '#8089a3'),
    brightRed: '#ff8a98',
    brightGreen: '#9be7bf',
    brightYellow: '#ffdc8a',
    brightBlue: '#84c8ff',
    brightMagenta: '#d0a7ff',
    brightCyan: '#8df0ea',
    brightWhite: '#f3f6ff',
  }
}

function clipboardImageFiles(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  const files: File[] = []
  const seen = new Set<string>()
  const add = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  if (items) {
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) add(file)
    }
  }
  for (const file of Array.from(e.clipboardData?.files ?? [])) {
    add(file)
  }
  return files
}

async function readClipboardImageFiles(): Promise<File[]> {
  if (!navigator.clipboard?.read) return []
  const items = await navigator.clipboard.read()
  const files: File[] = []
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    const ext = imageType.split('/')[1] || 'png'
    files.push(new File([blob], `paste.${ext}`, { type: imageType }))
  }
  return files
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
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: 8000,
      smoothScrollDuration: 80,
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: true,
      theme: terminalTheme(),
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
      if (launch.prompt && !launch.images?.length) qs.set('prompt', launch.prompt)
    } else if (sessionId) {
      qs.set('sessionId', sessionId)
    }
    const ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
    ws.binaryType = 'arraybuffer'

    const pasteIsForThisTerminal = (e: Event) => {
      const shell = shellRef.current
      const target = e.target instanceof Node ? e.target : null
      const active = document.activeElement
      return !!shell && ((target && shell.contains(target)) || (active && shell.contains(active)))
    }

    // Resume + auto-submit: when resuming a session with an initial message, send it once the
    // pty socket is open, followed by a carriage return so the agent receives + runs it.
    const sendInput = (d: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
    }
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }))
    }
    const sendImage = (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (ws.readyState !== WebSocket.OPEN || typeof reader.result !== 'string') return
        ws.send(JSON.stringify({
          t: 'img',
          name: file.name || 'paste',
          d: reader.result,
        }))
      }
      reader.readAsDataURL(file)
    }
    const sendImageData = (image: { name: string; dataUrl: string }) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({
        t: 'img',
        name: image.name || 'paste',
        d: image.dataUrl,
      }))
    }
    let launchImagesSent = false
    let launchedSessionId: string | null = null
    let recentOutput = ''
    const sendLaunchImagesAndPrompt = (): boolean => {
      const images = launch?.images?.filter((image) => image.dataUrl) ?? []
      if (!launch || launchImagesSent || !images.length) return false
      launchImagesSent = true
      for (const image of images) sendImageData(image)
      const prompt = launch.prompt?.trim()
      if (prompt) sendInput(`\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r`)
      else sendInput('\r')
      if (launchedSessionId) onLaunched?.(launchedSessionId)
      return true
    }
    const maybeSendLaunchImagesAndPrompt = () => {
      if (!launch?.images?.length || !launchedSessionId) return
      // Wait until the CLI has enabled bracketed paste mode. Sending image paths before this point
      // makes Codex/Claude echo the escape markers as literal text during startup.
      if (!recentOutput.includes('\x1b[?2004h')) return
      sendLaunchImagesAndPrompt()
    }
    let imagePasteHandledAt = 0
    const onPaste = (e: ClipboardEvent) => {
      if (!pasteIsForThisTerminal(e)) return
      const files = clipboardImageFiles(e)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      imagePasteHandledAt = Date.now()
      files.forEach(sendImage)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'v' || !pasteIsForThisTerminal(e)) return
      const startedAt = Date.now()
      window.setTimeout(() => {
        if (imagePasteHandledAt >= startedAt) return
        void readClipboardImageFiles()
          .then((files) => {
            if (!files.length) return
            imagePasteHandledAt = Date.now()
            files.forEach(sendImage)
          })
          .catch(() => {})
      }, 80)
    }
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('keydown', onKeyDown, true)
    ws.addEventListener('open', sendResize, { once: true })

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
          if (ctl.__berth === 'launched' && ctl.sessionId) {
            launchedSessionId = ctl.sessionId
            // Image-backed launches can't put the prompt in the URL. Keep this fresh-launch socket
            // mounted until the CLI announces bracketed-paste readiness and the payload is submitted.
            if (!launch?.images?.length) onLaunched?.(ctl.sessionId)
            else maybeSendLaunchImagesAndPrompt()
          }
          return // a well-formed control frame is not terminal output
        } catch {
          // not actually a control frame (e.g. pty output that happens to start
          // with that text, or a split chunk) — fall through and render it.
        }
      }
      recentOutput = (recentOutput + data).slice(-4096)
      maybeSendLaunchImagesAndPrompt()
      term.write(data)
    }
    const disp = term.onData((d) => {
      sendInput(d)
    })

    let resizeFrame: number | null = null
    const fitAndResize = () => {
      resizeFrame = null
      try {
        fit.fit()
        sendResize()
      } catch {
        // xterm can briefly report zero-sized geometry while drawers animate.
      }
    }
    const onResize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(fitAndResize)
    }
    window.addEventListener('resize', onResize)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    resizeObserver?.observe(host)
    if (shellRef.current) resizeObserver?.observe(shellRef.current)
    onResize()

    return () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', onResize)
      host.removeEventListener('mousedown', refocus)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('keydown', onKeyDown, true)
      disp.dispose()
      ws.close()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, initialInput, launch?.cli, launch?.cwd, launch?.launchToken, launch?.prompt, launch?.projectId, launch?.todoKey, launch?.images])

  return (
    <div ref={shellRef} className="berth-terminal-shell h-full w-full overflow-hidden bg-canvas p-2">
      <div ref={hostRef} className="berth-xterm h-full w-full" />
    </div>
  )
}
