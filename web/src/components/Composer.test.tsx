import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Composer } from './Composer'
import type { PastedImage } from './ImagePaste'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Composer', () => {
  it('renders an icon-only stop button while busy', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let interrupted = false

    try {
      await act(async () => {
        root.render(<Composer onSend={() => {}} onInterrupt={() => { interrupted = true }} busy={true} />)
      })

      const button = host.querySelector('button[aria-label="停止当前回合"]')
      expect(button).not.toBeNull()
      expect(button?.textContent).toBe('')
      expect(button?.querySelector('svg')).not.toBeNull()

      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(interrupted).toBe(true)
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  })

  it('accepts pasted images and sends an image-only turn', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const sent: { text: string; images?: PastedImage[] }[] = []

    try {
      await act(async () => {
        root.render(<Composer onSend={(text, images) => sent.push({ text, images })} onInterrupt={() => {}} busy={false} />)
      })

      const textarea = host.querySelector('textarea')
      if (!textarea) throw new Error('textarea not rendered')
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          items: [{ type: 'image/png', getAsFile: () => file }],
          files: [file],
        },
      })

      await act(async () => {
        textarea.dispatchEvent(paste)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(host.querySelectorAll('img')).toHaveLength(1)
      const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '发送')
      if (!button) throw new Error('send button not rendered')

      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(sent).toHaveLength(1)
      expect(sent[0].text).toBe('')
      expect(sent[0].images).toHaveLength(1)
      expect(sent[0].images?.[0]).toMatchObject({ name: 'shot.png' })
      expect(sent[0].images?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/)
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  })
})
