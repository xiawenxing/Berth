import { describe, it, expect } from 'vitest'
import { extractSemver, semverGte } from '../src/pty/availability'

describe('semver helpers', () => {
  it('extracts x.y.z from real --version output', () => {
    expect(extractSemver('codex-cli 0.139.0')).toBe('0.139.0')
    expect(extractSemver('2.1.4 (Claude Code)')).toBe('2.1.4')
    expect(extractSemver('no version here')).toBeNull()
  })
  it('compares semver with >= semantics', () => {
    expect(semverGte('0.139.0', '0.40.0')).toBe(true)
    expect(semverGte('0.40.0', '0.40.0')).toBe(true)
    expect(semverGte('0.39.9', '0.40.0')).toBe(false)
    expect(semverGte('1.0.0', '0.40.0')).toBe(true)
    expect(semverGte('2.0.0', '10.0.0')).toBe(false)
  })
})
