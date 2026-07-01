import { useEffect, useRef, useState } from 'react'
import type { LaunchSpec } from './ui-store'
import { api } from './api'
import { applyChatFrame, chatBusy, chatThinking, clearsAwaiting, makeUserTurn, stopInFlightTurns, type ChatFrame, type ChatTurn } from './chat'
import { appendLaunchFirstTurnParams } from './launch-runner'

export interface ChatSession {
  turns: ChatTurn[]
  model?: string
  historyLoading: boolean
  historyError?: string
  /** a turn is in flight (submitted-and-awaiting OR an assistant turn streaming) → composer shows 停止 */
  busy: boolean
  /** submitted, but the agent hasn't produced its first frame yet — show a "thinking…" indicator */
  thinking: boolean
  connected: boolean
  send: (text: string, images?: ChatImage[]) => void
  interrupt: () => void
}

export interface ChatImage {
  name: string
  dataUrl: string
  marker?: string
}

/**
 * Model B session over the persistent-PTY /pty WS in stream-json render mode. Mirrors Terminal's WS
 * lifecycle (resume via sessionId / fresh launch via launch spec, the {__berth:'launched'} handshake,
 * teardown on unmount) but consumes structured ChatFrames instead of raw bytes, and exposes send/
 * interrupt for the composer. On resume it seeds history from the on-disk jsonl, then attaches live.
 */
export function useChatSession({
  sessionId,
  launch,
  onLaunched,
}: {
  sessionId?: string
  launch?: LaunchSpec
  onLaunched?: (sessionId: string) => void
}): ChatSession {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [model, setModel] = useState<string | undefined>()
  const [connected, setConnected] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | undefined>()
  // True from a user submit until the agent's first assistant frame (or an error). Bridges the
  // thinking gap where neither the optimistic user turn nor any assistant turn is `streaming` yet,
  // so the composer/transcript still show "in flight" instead of looking idle.
  const [awaiting, setAwaiting] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const turnSeqRef = useRef(0)

  useEffect(() => {
    let disposed = false
    setTurns([])
    setModel(undefined)
    setAwaiting(false)
    setHistoryError(undefined)
    setHistoryLoading(!!sessionId && !launch)

    // Resume: seed history from the durable jsonl before the live stream attaches (resume does NOT
    // re-stream prior turns — verified). Fresh launches have no history.
    if (sessionId && !launch) {
      api.chatHistory(sessionId)
        .then((r) => {
          if (disposed) return
          if (r.turns?.length) setTurns((cur) => (cur.length ? cur : r.turns))
          if (r.truncated && !r.turns?.length) setHistoryError('会话历史过大，已跳过历史加载。')
        })
        .catch(() => { if (!disposed) setHistoryError('会话历史加载失败。') })
        .finally(() => { if (!disposed) setHistoryLoading(false) })
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const qs = new URLSearchParams({ render: 'stream-json' })
    if (launch) {
      qs.set('new', '1')
      qs.set('cli', launch.cli)
      qs.set('cwd', launch.cwd)
      if (launch.launchToken) qs.set('launchToken', launch.launchToken)
      if (launch.projectId) qs.set('projectId', launch.projectId)
      if (launch.todoKey) qs.set('todoKey', launch.todoKey)
      appendLaunchFirstTurnParams(qs, launch, true) // Model B → renderStream true
      if (launch.ctxProject === false) qs.set('ctxProject', '0')
      if (launch.ctxTask === false) qs.set('ctxTask', '0')
      for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
    } else if (sessionId) {
      qs.set('sessionId', sessionId)
    }
    const ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
    wsRef.current = ws
    ws.addEventListener('open', () => { if (!disposed) setConnected(true) })
    ws.addEventListener('close', () => { if (!disposed) { setConnected(false); setAwaiting(false) } })
    ws.onmessage = (e) => {
      if (disposed || typeof e.data !== 'string') return
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }   // stream mode is all-JSON; ignore stray bytes
      if (msg.__berth === 'launched') {
        if (msg.sessionId) onLaunched?.(msg.sessionId)
        // The drawer-independent prime socket (lib/launch-runner) submits the launch's first turn
        // (images + prompt), so closing the drawer mid-launch can't drop it; this view just attaches.
        // A launch that auto-fires a first turn (images here, or a server-side ?prompt=) is
        // immediately awaiting the agent — show the thinking indicator from the handshake on.
        if (launch?.prompt?.trim() || launch?.images?.length) setAwaiting(true)
        return
      }
      const frame = msg as ChatFrame
      if (clearsAwaiting(frame)) setAwaiting(false)
      if (frame.type === 'session') { if (frame.model) setModel(frame.model); return }
      setTurns((cur) => applyChatFrame(cur, frame))
    }

    return () => {
      disposed = true
      wsRef.current = null
      try { ws.close() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, launch?.cli, launch?.cwd, launch?.launchToken, launch?.prompt, launch?.projectId, launch?.todoKey, launch?.images])

  const sendRaw = (obj: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  return {
    turns,
    model,
    historyLoading,
    historyError,
    connected,
    busy: chatBusy(turns, awaiting),
    thinking: chatThinking(turns, awaiting),
    send: (text: string, images?: ChatImage[]) => {
      const t = text.trim()
      const validImages = (images ?? []).filter((image) => image.dataUrl)
      const ws = wsRef.current
      if ((!t && validImages.length === 0) || !ws || ws.readyState !== WebSocket.OPEN) return
      const clientTurnId = `client_${Date.now()}_${++turnSeqRef.current}`
      setTurns((cur) => applyChatFrame(cur, {
        type: 'turn',
        turn: makeUserTurn(clientTurnId, t, undefined, validImages.map((image) => ({ src: image.dataUrl, alt: image.name }))),
      }))
      setAwaiting(true)   // waiting on the agent's first frame — keeps the composer/transcript "in flight"
      ws.send(JSON.stringify({ t: 'turn', text: t, images: validImages, clientTurnId }))
    },
    interrupt: () => {
      sendRaw({ t: 'interrupt' })
      setAwaiting(false)
      setTurns((cur) => stopInFlightTurns(cur))
    },
  }
}
