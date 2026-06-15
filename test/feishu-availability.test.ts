import { describe, it, expect } from 'vitest'
import { friendlyLarkError } from '../src/data/sync/feishu'

describe('friendlyLarkError', () => {
  it('translates a missing-lark-cli ENOENT into an optional-plugin message', () => {
    const e = friendlyLarkError({ code: 'ENOENT', message: 'spawn lark-cli ENOENT' })
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toMatch(/lark-cli/)
    expect(e.message).toMatch(/optional/i)
  })

  it('passes a non-ENOENT error through unchanged', () => {
    const orig = new Error('boom')
    expect(friendlyLarkError(orig).message).toBe('boom')
  })

  it('does not misclassify a lark-cli runtime error whose stderr merely mentions ENOENT', () => {
    // exit-code failures carry a numeric `code` and lark-cli's stderr in the message — they must NOT
    // be reported as "lark-cli not found on PATH", which would drop the real diagnostics.
    const e = friendlyLarkError({ code: 1, message: 'Command failed: lark-cli base +record-list\nError: open /x: ENOENT' })
    expect(e.message).not.toMatch(/not found on PATH/)
    expect(e.message).toMatch(/Command failed/)
  })
})
