export function submitSessionInput(sessionId: string, text: string): Promise<void> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const qs = new URLSearchParams({ sessionId, cols: '120', rows: '30' })
  const ws = new WebSocket(`${proto}://${location.host}/pty?${qs.toString()}`)
  let settled = false

  const sendInput = (d: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
  }

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      sendInput(text)
      sendInput('\r')
      settled = true
      resolve()
      window.setTimeout(() => ws.close(), 1000)
    }, { once: true })
    ws.addEventListener('error', () => {
      if (!settled) reject(new Error('failed to open session pty'))
    }, { once: true })
  })
}
