import { describe, expect, it } from 'vitest'
import { isSessionTerminateInput, isSessionTerminateKeyboardEvent } from './terminal-shortcuts'

describe('isSessionTerminateInput', () => {
  it('recognizes control inputs that terminate the session dimension', () => {
    expect(isSessionTerminateInput('\x04')).toBe(true)
    expect(isSessionTerminateInput('\x1a')).toBe(true)
    expect(isSessionTerminateInput('\x1c')).toBe(true)
  })

  it('recognizes the same session-level controls from ordinary keyboard events', () => {
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: true, altKey: false, metaKey: false, key: 'd' })).toBe(true)
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: true, altKey: false, metaKey: false, key: 'Z' })).toBe(true)
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: true, altKey: false, metaKey: false, key: '\\' })).toBe(true)
  })

  it('leaves current-action interrupts, regular terminal controls, and text alone', () => {
    expect(isSessionTerminateInput('\x03')).toBe(false)
    expect(isSessionTerminateInput('\r')).toBe(false)
    expect(isSessionTerminateInput('\x0c')).toBe(false)
    expect(isSessionTerminateInput('\x1b[A')).toBe(false)
    expect(isSessionTerminateInput('c')).toBe(false)
    expect(isSessionTerminateInput('hello')).toBe(false)
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: true, altKey: false, metaKey: false, key: 'c' })).toBe(false)
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: false, altKey: false, metaKey: false, key: 'd' })).toBe(false)
    expect(isSessionTerminateKeyboardEvent({ ctrlKey: true, altKey: false, metaKey: true, key: 'd' })).toBe(false)
  })
})
