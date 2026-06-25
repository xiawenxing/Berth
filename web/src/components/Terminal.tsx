import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { stripTerminalGeneratedInput } from '@/lib/terminal-input'
import { attachImeComposition } from '@/lib/ime-input'
import { shouldShowLoadingOverlay, LOADING_OVERLAY_DELAY_MS, RESUME_STABLE_READY_MS, RESUME_OVERLAY_FALLBACK_MS } from '@/lib/loading-overlay'
import { LAUNCH_READY_FALLBACK_MS, LAUNCH_STABLE_READY_MS, shouldMarkLaunchReady } from '@/lib/launch-readiness'
import type { LaunchSpec } from '@/lib/ui-store'
import '@xterm/xterm/css/xterm.css'

const DEFAULT_PTY_HISTORY_BYTES = 16 * 1024 * 1024
const MAX_PTY_HISTORY_BYTES = 64 * 1024 * 1024

export type { LaunchSpec }

function cssToken(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function isLightMode() {
  return document.documentElement.classList.contains('light')
}

// CLI TUIs (claude / codex / coco) pick their ANSI colors assuming a DARK terminal — lots of light
// grays, pastels, and a near-white "brightWhite". On Berth's light canvas those wash out (coco's dim
// secondary text especially). In light mode we keep the light background (the user's choice) but swap
// in a DARKER, saturated ANSI palette where "bright" means bolder/darker, not lighter; pair it with
// xterm's minimumContrastRatio (set on the terminal) to catch dim/arbitrary colors the palette can't.
function terminalTheme() {
  if (isLightMode()) {
    return {
      background: cssToken('--color-canvas', '#eef1f6'),
      foreground: cssToken('--color-foreground', '#1f2733'),
      cursor: cssToken('--color-brand', '#2f6fed'),
      cursorAccent: cssToken('--color-brand-foreground', '#ffffff'),
      selectionBackground: 'rgba(47, 111, 237, 0.24)',
      black: '#1f2733',
      red: cssToken('--color-destructive', '#dc4338'),
      green: cssToken('--color-success', '#2a9d63'),
      yellow: cssToken('--color-warning', '#b9831b'),
      blue: cssToken('--color-brand', '#2f6fed'),
      magenta: cssToken('--color-purple', '#7a37b8'),
      cyan: cssToken('--color-info', '#0e9aae'),
      white: '#46505f',          // ANSI "white" on a light bg → a mid-dark gray (still visible)
      brightBlack: '#6b7280',    // dim/gray text → a readable gray, not near-white
      brightRed: '#c0392b',
      brightGreen: '#1f7a4d',
      brightYellow: '#8a5d0f',
      brightBlue: '#1d4ed8',
      brightMagenta: '#6d28a8',
      brightCyan: '#0c7a89',
      brightWhite: '#1f2733',    // emphasis → near-black, not near-white
    }
  }
  return {
    background: cssToken('--color-canvas', '#0d1220'),
    foreground: cssToken('--color-foreground', '#d7deef'),
    cursor: cssToken('--color-brand', '#56b6ff'),
    cursorAccent: cssToken('--color-brand-foreground', '#0d1220'),
    selectionBackground: 'rgba(86, 182, 255, 0.24)',
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
 *    surfaced via onLaunched so callers can bind list/header metadata while keeping this first
 *    launch socket mounted for the initial streamed turn.
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
  const [historyBytes, setHistoryBytes] = useState(DEFAULT_PTY_HISTORY_BYTES)
  // Resume overlay is delayed and hidden on first output. Fresh-launch overlay is immediate and
  // stays until the CLI is ready-ish, so slow first-time directory startup does not show a half-built
  // TUI as if it were ready for input.
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    setShowOverlay(!!launch)
    let firstDataSeen = false
    let launchReady = !launch
    let recentLaunchOutput = ''
    let queuedLaunchInput = ''
    let lastLaunchDataAt = 0
    const launchedAt = Date.now()
    let ws: WebSocket | null = null
    let stableLaunchTimer: ReturnType<typeof setTimeout> | null = null
    let launchFallbackTimer: ReturnType<typeof setTimeout> | null = null
    // Resume overlay lifecycle: shown after a short delay if no data yet (cold open), then HELD
    // through the reconnect redraw and torn down only once the replayed stream settles (or a hard
    // cap fires). This is what stops the user from seeing the messy intermediate redraw on resume.
    let resumeOverlayShown = false
    let resumeStableTimer: ReturnType<typeof setTimeout> | null = null
    let resumeFallbackTimer: ReturnType<typeof setTimeout> | null = null
    const hideResumeOverlay = () => {
      if (resumeStableTimer) { clearTimeout(resumeStableTimer); resumeStableTimer = null }
      if (resumeFallbackTimer) { clearTimeout(resumeFallbackTimer); resumeFallbackTimer = null }
      setShowOverlay(false)
    }
    const scheduleResumeOverlayHide = () => {
      if (!resumeOverlayShown) return
      if (resumeStableTimer) clearTimeout(resumeStableTimer)
      resumeStableTimer = setTimeout(hideResumeOverlay, RESUME_STABLE_READY_MS)
    }
    let overlayTimer: ReturnType<typeof setTimeout> | null = launch ? null : setTimeout(() => {
      overlayTimer = null
      if (!shouldShowLoadingOverlay({ hasData: firstDataSeen, elapsedMs: LOADING_OVERLAY_DELAY_MS })) return
      resumeOverlayShown = true
      setShowOverlay(true)
      resumeFallbackTimer = setTimeout(hideResumeOverlay, RESUME_OVERLAY_FALLBACK_MS)
    }, LOADING_OVERLAY_DELAY_MS)
    const sendInputNow = (d: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
    }
    const flushQueuedLaunchInput = () => {
      if (!queuedLaunchInput) return
      const d = queuedLaunchInput
      queuedLaunchInput = ''
      sendInputNow(d)
    }
    const markLaunchReady = () => {
      if (launchReady) return
      launchReady = true
      if (stableLaunchTimer) { clearTimeout(stableLaunchTimer); stableLaunchTimer = null }
      if (launchFallbackTimer) { clearTimeout(launchFallbackTimer); launchFallbackTimer = null }
      setShowOverlay(false)
      flushQueuedLaunchInput()
    }
    const evaluateLaunchReady = () => {
      if (!launch || launchReady) return
      const now = Date.now()
      if (shouldMarkLaunchReady({
        cli: launch.cli,
        recentOutput: recentLaunchOutput,
        sawData: firstDataSeen,
        quietMs: lastLaunchDataAt ? now - lastLaunchDataAt : 0,
        elapsedMs: now - launchedAt,
      })) {
        markLaunchReady()
      }
    }
    const scheduleStableLaunchReady = () => {
      if (!launch || launchReady) return
      if (stableLaunchTimer) clearTimeout(stableLaunchTimer)
      stableLaunchTimer = setTimeout(evaluateLaunchReady, LAUNCH_STABLE_READY_MS)
    }
    if (launch) {
      launchFallbackTimer = setTimeout(markLaunchReady, LAUNCH_READY_FALLBACK_MS)
    }
    const markDataSeen = () => {
      if (firstDataSeen) return
      firstDataSeen = true
      if (!launch) {
        // Warm resume (data beat the show-delay): cancel the pending overlay so it never flashes.
        // Cold resume (overlay already up): keep it; scheduleResumeOverlayHide drains it once the
        // replayed redraw goes quiet, so the garbled intermediate state stays hidden behind it.
        if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }
        if (!resumeOverlayShown) setShowOverlay(false)
      }
    }

    const term = new Xterm({
      // Resolve --font-mono to a literal font stack. xterm hands fontFamily straight to the Canvas2D
      // glyph rasterizer the WebGL/canvas renderers use, and Canvas `ctx.font` does NOT resolve CSS
      // `var()` — passing 'var(--font-mono)' makes it fall back to a proportional default whose advance
      // width != the monospace cell, spacing every glyph out. (The DOM renderer hid this because it
      // sets font-family on real DOM, where the browser resolves the variable.)
      fontFamily: cssToken('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      // Scrollback the terminal retains for scroll-up. A TUI byte stream can't paginate older history
      // on demand (once bytes leave the buffer they're gone) — the full transcript lives in the chat
      // (Model B) view; this just widens how much the terminal itself retains. Paired with the server
      // ring buffer (replayed on resume). Kept moderate: a huge buffer inflates per-session memory and
      // makes the renderer do more work on scroll; 10k lines is ample for in-terminal scrollback.
      scrollback: 10000,
      // No smooth-scroll animation: animating every wheel tick over 80ms made scrollback feel laggy
      // and unresponsive (rapid ticks queue/restart the animation). Default 0 = instant, snappy scroll.
      smoothScrollDuration: 0,
      // Lines moved per wheel notch. xterm's default is 1 (one line/tick), which reads as sluggish
      // when skimming scrollback; 3 covers ground without overshooting. Alt-scroll uses the separate
      // fastScrollSensitivity (default 5).
      scrollSensitivity: 3,
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: true,
      theme: terminalTheme(),
      // In light mode, force every foreground color to clear a contrast floor against the light
      // background so coco's dim/gray output (which the static palette can't reach) stays readable.
      // Off (1) in dark mode — the dark palette is already tuned and we don't want it re-tinted.
      minimumContrastRatio: isLightMode() ? 4.5 : 1,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Make plain-text URLs clickable. xterm only linkifies OSC-8 escape-sequence links out of the box;
    // most URLs a CLI prints (localhost dashboards, doc/PR links) are plain text and need this addon.
    // Gate activation on ⌘/Ctrl so a normal click still reaches selection / the TUI's own mouse
    // handling — matching native-terminal cmd-click muscle memory.
    term.loadAddon(new WebLinksAddon((e, uri) => {
      if (!(e.metaKey || e.ctrlKey)) return
      window.open(uri, '_blank', 'noopener,noreferrer')
    }))
    term.open(host)
    fit.fit()

    // GPU renderer. Without it xterm falls back to the DOM renderer, which is markedly slower at the
    // two things this drawer does most — scrolling long scrollback and dragging a text selection
    // (it rebuilds selection/​row DOM on every frame). WebGL draws to a canvas instead, so both stay
    // smooth. Guard it: WebGL can be unavailable (headless, blocklisted GPU) or lose its context at
    // runtime — on either, dispose the addon and let xterm fall back to the DOM renderer rather than
    // render nothing.
    let webgl: WebglAddon | null = null
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl?.dispose()
        webgl = null
      })
      term.loadAddon(webgl)
    } catch {
      webgl?.dispose()
      webgl = null
    }
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
      for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
      if (launch.ctxProject === false) qs.set('ctxProject', '0')
      if (launch.ctxTask === false) qs.set('ctxTask', '0')
      if (launch.prompt && !launch.images?.length) qs.set('prompt', launch.prompt)
    } else if (sessionId) {
      qs.set('sessionId', sessionId)
      qs.set('historyBytes', String(historyBytes))
    }
    ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
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
      if (launch && !launchReady) {
        queuedLaunchInput += d
        return
      }
      sendInputNow(d)
    }
    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }))
    }
    const sentImageDataUrls = new Set<string>()
    const sendImageData = (image: { name: string; dataUrl: string }) => {
      if (ws?.readyState !== WebSocket.OPEN || !image.dataUrl) return false
      if (sentImageDataUrls.has(image.dataUrl)) return false
      sentImageDataUrls.add(image.dataUrl)
      ws.send(JSON.stringify({
        t: 'img',
        name: image.name || 'paste',
        d: image.dataUrl,
      }))
      return true
    }
    const sendImage = (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (ws?.readyState !== WebSocket.OPEN || typeof reader.result !== 'string') return
        sendImageData({ name: file.name || 'paste', dataUrl: reader.result })
      }
      reader.readAsDataURL(file)
    }
    let replayPositionRestored = false
    let suppressHistoryLoadUntil = 0
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
            // The drawer-independent prime socket (lib/launch-runner) owns submitting the launch's
            // images+prompt, so closing the drawer mid-launch can't drop them. This viewer only binds
            // the drawer to the real session id.
            onLaunched?.(ctl.sessionId)
          }
          return // a well-formed control frame is not terminal output
        } catch {
          // not actually a control frame (e.g. pty output that happens to start
          // with that text, or a split chunk) — fall through and render it.
        }
      }
      markDataSeen()
      if (launch) {
        recentLaunchOutput = (recentLaunchOutput + data).slice(-4096)
        lastLaunchDataAt = Date.now()
        evaluateLaunchReady()
        scheduleStableLaunchReady()
      } else if (resumeOverlayShown) {
        scheduleResumeOverlayHide()
      }
      term.write(data, () => {
        if (!replayPositionRestored && !launch && historyBytes > DEFAULT_PTY_HISTORY_BYTES) {
          replayPositionRestored = true
          suppressHistoryLoadUntil = Date.now() + 1000
          term.scrollToTop()
        }
      })
    }
    const disp = term.onData((d) => {
      const userInput = stripTerminalGeneratedInput(d)
      if (userInput) sendInput(userInput)
    })
    // IME-safe CJK input: bypass xterm's textarea-slicing CompositionHelper (it intermittently
    // drops/duplicates/reorders committed characters) and send the browser's authoritative
    // CompositionEvent.data ourselves. Attached after term.open() so it runs after xterm's own
    // composition handler. See lib/ime-input.ts.
    const disposeIme = term.textarea ? attachImeComposition(term.textarea, sendInput) : undefined

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
    const scrollDisp = term.onScroll((pos) => {
      if (launch || !sessionId || historyBytes >= MAX_PTY_HISTORY_BYTES) return
      if (!firstDataSeen || Date.now() < suppressHistoryLoadUntil) return
      if (pos > 2 || term.buffer.active.length <= term.rows + 5) return
      setHistoryBytes((cur) => cur >= MAX_PTY_HISTORY_BYTES ? cur : Math.min(cur * 2, MAX_PTY_HISTORY_BYTES))
    })

    return () => {
      if (overlayTimer) clearTimeout(overlayTimer)
      if (stableLaunchTimer) clearTimeout(stableLaunchTimer)
      if (launchFallbackTimer) clearTimeout(launchFallbackTimer)
      if (resumeStableTimer) clearTimeout(resumeStableTimer)
      if (resumeFallbackTimer) clearTimeout(resumeFallbackTimer)
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', onResize)
      host.removeEventListener('mousedown', refocus)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('keydown', onKeyDown, true)
      disp.dispose()
      scrollDisp.dispose()
      disposeIme?.()
      ws?.close()
      webgl?.dispose()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, initialInput, launch?.cli, launch?.cwd, launch?.launchToken, launch?.prompt, launch?.projectId, launch?.todoKey, launch?.images,
    launch?.addDirs, launch?.ctxProject, launch?.ctxTask, historyBytes,
  ])

  return (
    <div ref={shellRef} className="berth-terminal-shell relative h-full w-full overflow-hidden bg-canvas py-2 pl-4 pr-2">
      <div ref={hostRef} className="berth-xterm h-full w-full" />
      {showOverlay && (launch ? (
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-canvas/90 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-brand" />
          正在启动会话，等待 agent 就绪…
        </div>
      ) : (
        // Resume: cover the terminal while the replayed scrollback redraws, with a skeleton standing
        // in for the agent's input box at the bottom — so the reconnect window reads as "loading"
        // rather than leaking the half-drawn TUI / stray control sequences into view.
        <div className="absolute inset-0 flex flex-col justify-end gap-3 bg-canvas/90 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-brand" />
            正在恢复会话…
          </div>
          <div className="h-12 w-full animate-pulse rounded-lg border border-border bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  )
}
