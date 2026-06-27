import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { freshArgv, resumeArgv, ensureCodexBerthHookProfile, ensureLaunchCwd, codexCallbackDir } from '../src/pty/launch'

describe('ensureLaunchCwd', () => {
  it('creates a Berth workspace cwd on demand (never falls back to homedir)', () => {
    const home = mkdtempSync(join(tmpdir(), 'berth-home-'))
    const prev = process.env.BERTH_HOME
    process.env.BERTH_HOME = home
    try {
      const ws = join(home, 'workspaces', 'proj-xyz')
      expect(existsSync(ws)).toBe(false)
      expect(ensureLaunchCwd(ws)).toBe(ws)
      expect(existsSync(ws)).toBe(true)
    } finally {
      prev === undefined ? delete process.env.BERTH_HOME : (process.env.BERTH_HOME = prev)
      rmSync(home, { recursive: true, force: true })
    }
  })
  it('falls back to homedir for a non-existent NON-workspace cwd, keeps an existing one', () => {
    const real = mkdtempSync(join(tmpdir(), 'berth-cwd-'))
    try {
      expect(ensureLaunchCwd('/no/such/dir/xyz')).toBe(homedir())
      expect(ensureLaunchCwd(real)).toBe(real)
      expect(ensureLaunchCwd(null)).toBe(homedir())
    } finally {
      rmSync(real, { recursive: true, force: true })
    }
  })
})

// First-turn delivery is uniform: all three CLIs receive the first turn as their native positional
// `[PROMPT]`, which each CLI queues and auto-submits once ITS OWN composer is ready (verified live for
// claude/codex/coco — robust to slow startup). A previous claude-only "type after the bracketed-paste
// readiness marker" path was reverted: claude emits that marker ~0.4s in during its welcome banner,
// before the composer accepts input, so typing then raced startup and dropped the turn.

// Fresh launches run in bypass-permissions mode (Berth-launched, unattended):
//   claude --dangerously-skip-permissions · coco --yolo · codex --dangerously-bypass-approvals-and-sandbox

// Resume argv. coco's `--resume string[="AUTO"]` is a Go pflag OPTIONAL-value flag: the value must
// be attached with `=`. `--resume <id>` (space form) binds --resume to its default ("AUTO" →
// auto-resume most recent) and leaks <id> to the positional `[prompt]`, so coco submits the session
// id as a user turn ("Received: <uuid>"). claude/codex take the id space-separated.
it('coco: resume uses the =id form so the id is never parsed as a positional prompt', () => {
  expect(resumeArgv('coco', 'f60ef02f-7986-41c7-8f63-4067ddc06039'))
    .toEqual(['--resume=f60ef02f-7986-41c7-8f63-4067ddc06039'])
})

it('claude/codex: resume takes the id space-separated', () => {
  expect(resumeArgv('claude', 'uuid-1')).toEqual(['--resume', 'uuid-1'])
  expect(resumeArgv('codex', 'uuid-2')).toEqual(['resume', '--no-alt-screen', 'uuid-2'])
})

it('claude: session-id + bypass + system-prompt-file + add-dir, no positional', () => {
  const a = freshArgv('claude', { cwd: '/c', sessionId: 'uuid-1', injectFile: '/t/m.txt', addDirs: ['/vault'] })
  expect(a).toEqual(['--session-id', 'uuid-1', '--dangerously-skip-permissions', '--append-system-prompt-file', '/t/m.txt', '--add-dir', '/vault'])
})

it('coco: context-only launch stays idle; context is not submitted as a prompt', () => {
  const a = freshArgv('coco', { cwd: '/c', sessionId: 'uuid-2', injectFile: '/t/m.txt', addDirs: ['/vault'] })
  expect(a).toEqual(['--session-id', 'uuid-2', '--yolo', '--add-dir', '/vault'])
})

it('codex: context-only launch stays idle; context is not submitted as a prompt', () => {
  const a = freshArgv('codex', { cwd: '/c', injectFile: '/t/m.txt', addDirs: ['/vault'] })
  expect(a).toEqual(['--profile', 'berth-launch', '--dangerously-bypass-hook-trust', '--dangerously-bypass-approvals-and-sandbox', '--no-alt-screen', '--add-dir', '/vault'])
})

it('omits absent optional args cleanly (bypass still present)', () => {
  expect(freshArgv('claude', { cwd: '/c', sessionId: 'u' })).toEqual(['--session-id', 'u', '--dangerously-skip-permissions'])
})

it('claude: user prompt is appended as the positional arg, after `--`', () => {
  const a = freshArgv('claude', { cwd: '/c', sessionId: 'u', injectFile: '/m.txt', initialPrompt: 'hello' })
  expect(a).toEqual(['--session-id', 'u', '--dangerously-skip-permissions', '--append-system-prompt-file', '/m.txt', '--', 'hello'])
})

it('codex/coco: execution launches submit only the real first prompt; context is silent', () => {
  expect(freshArgv('codex', { cwd: '/c', injectFile: '/t/m.txt', initialPrompt: 'hello' }))
    .toEqual(['--profile', 'berth-launch', '--dangerously-bypass-hook-trust', '--dangerously-bypass-approvals-and-sandbox', '--no-alt-screen', '--', 'hello'])
  // coco's manifest now rides the session_start hook, not the prompt — the positional is just 'hello'.
  expect(freshArgv('coco', { cwd: '/c', sessionId: 'u', injectFile: '/t/m.txt', initialPrompt: 'hello' }))
    .toEqual(['--session-id', 'u', '--yolo', '--', 'hello'])
})

// Per-CLI default model (configurable in Settings) is passed as --model on a FRESH launch where the
// CLI supports it (claude/codex). coco has no --model flag, so its model is never emitted.
it('claude: model is passed as --model after the bypass flag', () => {
  const a = freshArgv('claude', { cwd: '/c', sessionId: 'u', model: 'claude-opus-4-8' })
  expect(a).toEqual(['--session-id', 'u', '--dangerously-skip-permissions', '--model', 'claude-opus-4-8'])
})

it('codex: model is passed as --model', () => {
  const a = freshArgv('codex', { cwd: '/c', model: 'gpt-5' })
  expect(a).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--no-alt-screen', '--model', 'gpt-5'])
})

it('coco: model is never emitted (no --model flag)', () => {
  const a = freshArgv('coco', { cwd: '/c', sessionId: 'u', model: 'whatever' })
  expect(a).toEqual(['--session-id', 'u', '--yolo'])
})

it('model coexists with prompt: --model stays a flag, prompt stays the final positional', () => {
  const a = freshArgv('claude', { cwd: '/c', sessionId: 'u', model: 'm', initialPrompt: 'hi' })
  expect(a).toEqual(['--session-id', 'u', '--dangerously-skip-permissions', '--model', 'm', '--', 'hi'])
})

it('writes the Codex Berth profile hook under CODEX_HOME', () => {
  const prev = process.env.CODEX_HOME
  const home = mkdtempSync(join(tmpdir(), 'berth-codex-'))
  try {
    process.env.CODEX_HOME = home
    ensureCodexBerthHookProfile()
    const text = readFileSync(join(home, 'berth-launch.config.toml'), 'utf8')
    expect(text).toContain('[[hooks.SessionStart]]')
    expect(text).toContain('matcher = "startup"')
    expect(text).toContain('BERTH_CONTEXT_FILE')
  } finally {
    if (prev == null) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})

// Regression: `--add-dir <directories...>` is variadic and would otherwise swallow the positional
// prompt as a phantom directory, so the agent launches idle and never takes a turn. The prompt must
// be separated from add-dir by `--`, never adjacent to it. (This combination was previously untested.)
it('addDirs + initialPrompt together: prompt is fenced behind `--`, never directly after --add-dir', () => {
  for (const cli of ['claude', 'coco', 'codex'] as const) {
    const a = freshArgv(cli, { cwd: '/c', sessionId: 'u', injectFile: '/m.txt', addDirs: ['/v1', '/v2'], initialPrompt: 'do it' })
    const dd = a.lastIndexOf('--add-dir')
    const sep = a.indexOf('--')
    expect(dd).toBeGreaterThanOrEqual(0)            // add-dir present
    expect(sep).toBeGreaterThan(dd)                 // `--` comes after the last --add-dir value
    expect(a[a.length - 1]).toContain('do it')      // the user prompt is the final positional
    expect(a[a.length - 2]).toBe('--')              // and it sits immediately behind the fence
  }
})

describe('codex SessionStart hook → callback file (channel A)', () => {
  let tmpHome = ''
  beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), 'berth-codexhome-')); process.env.CODEX_HOME = tmpHome })
  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); delete process.env.CODEX_HOME })

  it('generated profile writes the stdin envelope to $BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json and still cats context', () => {
    ensureCodexBerthHookProfile()
    const toml = readFileSync(join(process.env.CODEX_HOME || '', 'berth-launch.config.toml'), 'utf8')
    expect(toml).toContain('$BERTH_CALLBACK_DIR')
    expect(toml).toContain('$BERTH_LAUNCH_TOKEN')
    expect(toml).toContain('$BERTH_CONTEXT_FILE')   // context injection must NOT regress
  })
})
