import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { ensureCocoBerthHook, writeCocoContextPayload } from '../src/pty/coco-hook'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'berth-coco-hook-'))
}

describe('ensureCocoBerthHook', () => {
  it('adds a session_start hook that cats $BERTH_CONTEXT_FILE when the config is missing', () => {
    const dir = tmp()
    try {
      const cfg = join(dir, 'traecli.yaml')
      ensureCocoBerthHook(cfg)
      const doc = parse(readFileSync(cfg, 'utf8'))
      expect(doc.hooks).toHaveLength(1)
      expect(doc.hooks[0].command).toContain('BERTH_CONTEXT_FILE')
      expect(doc.hooks[0].command).toContain('cat')
      expect(doc.hooks[0].matchers).toEqual([{ event: 'session_start' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('preserves existing hooks and other config keys (Flux Island etc.)', () => {
    const dir = tmp()
    try {
      const cfg = join(dir, 'traecli.yaml')
      writeFileSync(cfg, [
        'model:',
        '    name: GPT-5.5',
        'hooks:',
        '    -',
        '        type: command',
        "        command: 'flux-hooks --source coco'",
        '        matchers:',
        '            -',
        '                event: stop',
        '',
      ].join('\n'))
      ensureCocoBerthHook(cfg)
      const doc = parse(readFileSync(cfg, 'utf8'))
      expect(doc.model).toEqual({ name: 'GPT-5.5' })
      expect(doc.hooks).toHaveLength(2)
      expect(doc.hooks[0].command).toContain('flux-hooks')      // owner's hook untouched
      expect(doc.hooks[1].command).toContain('BERTH_CONTEXT_FILE')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('is idempotent — a second call does not add a duplicate hook', () => {
    const dir = tmp()
    try {
      const cfg = join(dir, 'traecli.yaml')
      ensureCocoBerthHook(cfg)
      ensureCocoBerthHook(cfg)
      ensureCocoBerthHook(cfg)
      const doc = parse(readFileSync(cfg, 'utf8'))
      expect(doc.hooks.filter((h: any) => h.command.includes('BERTH_CONTEXT_FILE'))).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('refuses to clobber a config it cannot parse', () => {
    const dir = tmp()
    try {
      const cfg = join(dir, 'traecli.yaml')
      const garbage = 'this: : : not valid yaml\n  - [unbalanced'
      writeFileSync(cfg, garbage)
      ensureCocoBerthHook(cfg)
      expect(readFileSync(cfg, 'utf8')).toBe(garbage)            // left exactly as-is
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('writeCocoContextPayload', () => {
  it('wraps the manifest in coco\'s additionalContext envelope and JSON-escapes it', () => {
    const dir = tmp()
    try {
      const src = join(dir, 'abc.txt')
      const manifest = 'line1\n"quoted" and \\backslash\n任务上下文'
      writeFileSync(src, manifest)
      const out = writeCocoContextPayload(src)
      expect(out).toBe(join(dir, 'abc.coco.json'))
      expect(existsSync(out)).toBe(true)
      const payload = JSON.parse(readFileSync(out, 'utf8'))
      expect(payload).toEqual({ hookSpecificOutput: { additionalContext: manifest } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
