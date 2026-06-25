import { describe, it, expect } from 'vitest'
import { stripTerminalGeneratedInput } from './terminal-input'

describe('stripTerminalGeneratedInput', () => {
  it('drops Device Attributes (DA1) responses so they never reach the agent prompt', () => {
    // The exact leak seen on resume: a focus report + DA1 reply landing in the input box.
    expect(stripTerminalGeneratedInput('\x1b[I\x1b[?1;2c')).toBe('')
  })

  it('drops DA2 responses (CSI > … c)', () => {
    expect(stripTerminalGeneratedInput('\x1b[>0;276;0c')).toBe('')
  })

  it('drops focus in/out reports (CSI I / CSI O)', () => {
    expect(stripTerminalGeneratedInput('\x1b[I')).toBe('')
    expect(stripTerminalGeneratedInput('\x1b[O')).toBe('')
  })

  it('drops Cursor Position Reports (the resume garble `^[[1;1R^[[41;3R`)', () => {
    expect(stripTerminalGeneratedInput('\x1b[1;1R\x1b[41;3R')).toBe('')
    expect(stripTerminalGeneratedInput('\x1b[?1;1R')).toBe('')
  })

  it('still strips OSC color reports', () => {
    expect(stripTerminalGeneratedInput('\x1b]11;rgb:0d0d/1212/2020\x07')).toBe('')
  })

  it('strips a report wedged between real keystrokes, keeping the keystrokes', () => {
    expect(stripTerminalGeneratedInput('ab\x1b[?1;2ccd')).toBe('abcd')
  })

  it('leaves real CSI keystrokes intact (arrows / Home / End)', () => {
    expect(stripTerminalGeneratedInput('\x1b[A\x1b[B\x1b[C\x1b[D')).toBe('\x1b[A\x1b[B\x1b[C\x1b[D')
    expect(stripTerminalGeneratedInput('\x1b[H\x1b[F')).toBe('\x1b[H\x1b[F')
  })

  it('leaves SS3 function-key sequences intact (ESC O x, no bracket)', () => {
    expect(stripTerminalGeneratedInput('\x1bOP\x1bOA')).toBe('\x1bOP\x1bOA')
  })

  it('passes plain text through untouched', () => {
    expect(stripTerminalGeneratedInput('hello world')).toBe('hello world')
  })
})
