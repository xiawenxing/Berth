import { describe, it, expect, vi } from 'vitest'

// The img branch persists the pasted image via the DocStore, then writes its on-disk path into the
// pty. Mock the DocStore so the test neither touches the real docs root nor depends on its layout.
const saveAttachment = vi.fn((_dataUrl: string, _nameHint: string) => ({
  rel: 'assets/x.png',
  abs: '/Users/me/Documents/Obsidian Vault/assets/x.png',
}))
vi.mock('../src/data/docstore', () => ({
  currentDocStore: () => ({ saveAttachment }),
}))

import { registerPty, attachViewer, killPty } from '../src/server/pty-registry'

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: () => void = () => {}
  return {
    onData: (cb: any) => { dataCb = cb; return { dispose() {} } },
    onExit: (cb: any) => { exitCb = cb; return { dispose() {} } },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emit: (d: string) => dataCb(d),
    exit: () => exitCb(),
  } as any
}

// fakeWs that captures the 'message' handler so the test can feed it WS frames.
function fakeWs() {
  let msgCb: (raw: any) => void = () => {}
  let closeCb: () => void = () => {}
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: (ev: string, cb: any) => { if (ev === 'message') msgCb = cb; if (ev === 'close') closeCb = cb },
    emitMsg: (obj: any) => msgCb(Buffer.from(JSON.stringify(obj))),
    triggerClose: () => closeCb(),
  } as any
}

describe('pty-registry image paste', () => {
  it('persists a pasted image and writes its space-escaped path into the pty', () => {
    const pty = fakePty()
    registerPty('img-1', pty)
    const ws = fakeWs()
    attachViewer('img-1', ws)

    ws.emitMsg({ t: 'img', name: 'shot', d: 'data:image/png;base64,AAAA' })

    expect(saveAttachment).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'shot')
    // Spaces are backslash-escaped (macOS drag-drop convention) + a trailing space delimiter.
    expect(pty.write).toHaveBeenCalledWith('/Users/me/Documents/Obsidian\\ Vault/assets/x.png ')
    killPty('img-1')
  })

  it('falls back to a default name hint when none is provided', () => {
    const pty = fakePty()
    registerPty('img-name', pty)
    const ws = fakeWs()
    attachViewer('img-name', ws)

    ws.emitMsg({ t: 'img', d: 'data:image/png;base64,AAAA' })

    expect(saveAttachment).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'paste')
    killPty('img-name')
  })

  it('ignores an img message whose payload is not a string', () => {
    const pty = fakePty()
    registerPty('img-2', pty)
    const ws = fakeWs()
    attachViewer('img-2', ws)

    ws.emitMsg({ t: 'img', d: 123 })

    expect(pty.write).not.toHaveBeenCalled()
    killPty('img-2')
  })

  it('writes nothing when saveAttachment rejects the payload', () => {
    ;(saveAttachment as any).mockReturnValueOnce(null)
    const pty = fakePty()
    registerPty('img-3', pty)
    const ws = fakeWs()
    attachViewer('img-3', ws)

    ws.emitMsg({ t: 'img', name: 'x', d: 'data:text/plain;base64,AAAA' })

    expect(pty.write).not.toHaveBeenCalled()
    killPty('img-3')
  })
})
