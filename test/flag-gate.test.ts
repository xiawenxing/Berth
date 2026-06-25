import { describe, it, expect } from 'vitest'
import { gateArgv } from '../src/pty/flag-gate'

// A support oracle from a set of KNOWN-unsupported flags; everything else "supported" (true).
const unsupported = (flags: string[]) => (f: string): boolean | undefined => (flags.includes(f) ? false : true)

describe('gateArgv', () => {
  it('drops a confirmed-unsupported value flag together with its value', () => {
    const argv = ['--dangerously-skip-permissions', '--model', 'gpt-5', '--', 'hi']
    const { argv: out, dropped } = gateArgv('claude', argv, unsupported(['--model']))
    expect(out).toEqual(['--dangerously-skip-permissions', '--', 'hi'])
    expect(dropped).toEqual(['--model'])
  })

  it('drops a confirmed-unsupported bare flag, keeping its neighbors', () => {
    const argv = ['resume', '--no-alt-screen', 'sid']
    const { argv: out, dropped } = gateArgv('codex', argv, unsupported(['--no-alt-screen']))
    expect(out).toEqual(['resume', 'sid'])
    expect(dropped).toEqual(['--no-alt-screen'])
  })

  it('drops every occurrence of a repeated flag (variadic --add-dir pairs)', () => {
    const argv = ['--add-dir', '/a', '--add-dir', '/b', '--', 'go']
    const { argv: out } = gateArgv('claude', argv, unsupported(['--add-dir']))
    expect(out).toEqual(['--', 'go'])
  })

  it('keeps a flag whose support is UNKNOWN (cold cache → never degrade a working setup)', () => {
    const argv = ['--model', 'gpt-5', '--', 'hi']
    const { argv: out, dropped } = gateArgv('claude', argv, () => undefined)
    expect(out).toEqual(argv)
    expect(dropped).toEqual([])
  })

  it('keeps a supported flag and never touches load-bearing flags', () => {
    const argv = ['-p', '--output-format', 'stream-json', '--session-id', 'x', '--model', 'm']
    // even with model "supported", load-bearing flags aren't in the degradable list so they're inert
    const { argv: out } = gateArgv('claude', argv, () => true)
    expect(out).toEqual(argv)
  })

  it('returns the same array (no-op) when nothing is dropped', () => {
    const argv = ['--yolo', '--', 'hi']
    const { argv: out, dropped } = gateArgv('coco', argv, () => true)
    expect(out).toBe(argv)            // identity — no needless copy
    expect(dropped).toEqual([])
  })

  it('drops multiple distinct unsupported flags in one pass', () => {
    const argv = ['--no-alt-screen', '--model', 'm', '--add-dir', '/a', '--', 'hi']
    const { argv: out, dropped } = gateArgv('codex', argv, unsupported(['--no-alt-screen', '--add-dir']))
    expect(out).toEqual(['--model', 'm', '--', 'hi'])
    expect(dropped.sort()).toEqual(['--add-dir', '--no-alt-screen'])
  })
})
