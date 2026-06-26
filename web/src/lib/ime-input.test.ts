import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attachImeComposition } from './ime-input'

// jsdom gives us a real <textarea> + real CompositionEvent, so this exercises the same
// addEventListener ordering / `.value` semantics the fix relies on in the browser.
function makeTextarea(): HTMLTextAreaElement {
  const ta = document.createElement('textarea')
  document.body.appendChild(ta)
  return ta
}

function endComposition(ta: HTMLTextAreaElement, committed: string) {
  // The browser leaves the committed text in the textarea, then fires compositionend.
  ta.value += committed
  ta.dispatchEvent(new CompositionEvent('compositionend', { data: committed }))
}

describe('attachImeComposition', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('sends the committed composition text exactly once', () => {
    const ta = makeTextarea()
    const sendInput = vi.fn()
    attachImeComposition(ta, sendInput)

    endComposition(ta, '方式')

    expect(sendInput).toHaveBeenCalledTimes(1)
    expect(sendInput).toHaveBeenCalledWith('方式')
  })

  it('clears the textarea after each composition so xterm cannot accumulate/drift', () => {
    const ta = makeTextarea()
    const sendInput = vi.fn()
    attachImeComposition(ta, sendInput)

    endComposition(ta, '我有')
    expect(ta.value).toBe('') // reset to offset 0 — no accumulation across compositions
    endComposition(ta, '个疑问')
    expect(ta.value).toBe('')

    // Each composition delivered in order, intact, with no duplication/reordering.
    expect(sendInput.mock.calls.map((c) => c[0])).toEqual(['我有', '个疑问'])
  })

  it('preserves the order and content of many rapid consecutive compositions', () => {
    const ta = makeTextarea()
    const sendInput = vi.fn()
    attachImeComposition(ta, sendInput)

    const words = ['在', '不走', '结构化', '数据', '的', '方式', '下']
    for (const w of words) endComposition(ta, w)

    expect(sendInput.mock.calls.map((c) => c[0])).toEqual(words)
  })

  it('sends nothing when a composition is cancelled (empty data)', () => {
    const ta = makeTextarea()
    const sendInput = vi.fn()
    attachImeComposition(ta, sendInput)

    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '' }))

    expect(sendInput).not.toHaveBeenCalled()
  })

  it('stops handling input after dispose', () => {
    const ta = makeTextarea()
    const sendInput = vi.fn()
    const dispose = attachImeComposition(ta, sendInput)

    dispose()
    endComposition(ta, '方式')

    expect(sendInput).not.toHaveBeenCalled()
  })
})
