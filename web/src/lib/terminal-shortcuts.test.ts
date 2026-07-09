import { describe, expect, it } from 'vitest'
import { isSessionTerminateInput } from './terminal-shortcuts'

describe('isSessionTerminateInput', () => {
  it('recognizes control inputs that terminate the session dimension', () => {
    expect(isSessionTerminateInput('\x03')).toBe(true)
    expect(isSessionTerminateInput('\x04')).toBe(true)
    expect(isSessionTerminateInput('\x1a')).toBe(true)
    expect(isSessionTerminateInput('\x1c')).toBe(true)
  })

  it('leaves regular terminal controls and text alone', () => {
    expect(isSessionTerminateInput('\r')).toBe(false)
    expect(isSessionTerminateInput('\x0c')).toBe(false)
    expect(isSessionTerminateInput('\x1b[A')).toBe(false)
    expect(isSessionTerminateInput('c')).toBe(false)
    expect(isSessionTerminateInput('hello')).toBe(false)
  })
})
