import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { LaunchSpec } from './ui-store'
import { api } from './api'
import { applyChatFrame, makeUserTurn, type ChatFrame, type ChatTurn } from './chat'

export interface ChatSession {
  turns: ChatTurn[]
  model?: string
  /** any assistant turn still streaming → disable the composer's submit */
  busy: boolean
  connected: boolean
  send: (text: string, images?: ChatImage[]) => void
  interrupt: () => void
}

export interface ChatImage {
  name: string
  dataUrl: string
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
  const wsRef = useRef<WebSocket | null>(null)
  const turnSeqRef = useRef(0)
  const launchTurnSentRef = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    setTurns([])
    setModel(undefined)

    // Resume: seed history from the durable jsonl before the live stream attaches (resume does NOT
    // re-stream prior turns — verified). Fresh launches have no history.
    if (sessionId && !launch) {
      api.chatHistory(sessionId)
        .then((r) => { if (!disposed && r.turns?.length) setTurns((cur) => (cur.length ? cur : r.turns)) })
        .catch(() => {})
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
      if (launch.prompt && !launch.images?.length) qs.set('prompt', launch.prompt)
      if (launch.ctxProject === false) qs.set('ctxProject', '0')
      if (launch.ctxTask === false) qs.set('ctxTask', '0')
      for (const d of launch.addDirs ?? []) qs.append('addDirs', d)
    } else if (sessionId) {
      qs.set('sessionId', sessionId)
    }
    const ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
    wsRef.current = ws
    ws.addEventListener('open', () => { if (!disposed) setConnected(true) })
    ws.addEventListener('close', () => { if (!disposed) setConnected(false) })
    ws.onmessage = (e) => {
      if (disposed || typeof e.data !== 'string') return
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }   // stream mode is all-JSON; ignore stray bytes
      if (msg.__berth === 'launched') {
        if (msg.sessionId) onLaunched?.(msg.sessionId)
        if (launch?.images?.length) sendLaunchTurn(ws, launch, launchTurnSentRef)
        return
      }
      const frame = msg as ChatFrame
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
    connected,
    busy: turns.some((t) => t.streaming),
    send: (text: string, images?: ChatImage[]) => {
      const t = text.trim()
      const validImages = (images ?? []).filter((image) => image.dataUrl)
      const ws = wsRef.current
      if ((!t && validImages.length === 0) || !ws || ws.readyState !== WebSocket.OPEN) return
      const clientTurnId = `client_${Date.now()}_${++turnSeqRef.current}`
      setTurns((cur) => applyChatFrame(cur, { type: 'turn', turn: makeUserTurn(clientTurnId, displayTurnText(t, validImages.length)) }))
      ws.send(JSON.stringify({ t: 'turn', text: t, images: validImages, clientTurnId }))
    },
    interrupt: () => sendRaw({ t: 'interrupt' }),
  }
}

function displayTurnText(text: string, imageCount: number): string {
  if (!imageCount) return text
  const label = `已附加 ${imageCount} 张图片`
  return text ? `${text}\n\n${label}` : label
}

function sendLaunchTurn(ws: WebSocket, launch: LaunchSpec, sentRef: MutableRefObject<string | null>): void {
  const key = launch.launchToken ?? `${launch.cli}:${launch.cwd}:${launch.prompt ?? ''}`
  if (sentRef.current === key) return
  if (ws.readyState !== WebSocket.OPEN) return
  sentRef.current = key
  const text = launch.prompt?.trim() ?? ''
  const imageCount = launch.images?.length ?? 0
  if (!text && imageCount === 0) return
  const clientTurnId = `launch_${key}`
  ws.send(JSON.stringify({ t: 'turn', text, images: launch.images ?? [], clientTurnId }))
}
