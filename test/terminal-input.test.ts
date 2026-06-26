import { describe, expect, it } from 'vitest'
import { stripTerminalGeneratedInput } from '../web/src/lib/terminal-input'

describe('terminal input filtering', () => {
  it('drops xterm color query reports before they reach the pty', () => {
    const data = '\x1b]11;rgb:eeee/f1f1/f6f6\x1b\\\x1b]10;rgb:1f1f/2727/3333\x1b\\'
    expect(stripTerminalGeneratedInput(data)).toBe('')
  })

  it('keeps user input and bracketed paste payloads', () => {
    const data = 'hello\x1b[200~/tmp/image.png\x1b[201~\r'
    expect(stripTerminalGeneratedInput(data)).toBe(data)
  })
})
