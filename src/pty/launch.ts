import { spawn, type IPty } from 'node-pty'
import { spawn as spawnChild, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentBinary, codexHookTrustSupportOrWarm } from './binaries'
import { ensureClaudeTrust } from './trust'
import { ensureCocoBerthHook, writeCocoContextPayload } from './coco-hook'
import { berthHome, dataHome } from '../paths'
import type { AgentCli, LogicalSession } from '../types'

const CODEX_BERTH_PROFILE = 'berth-launch'
const codexHome = () => process.env.CODEX_HOME || join(dataHome(), '.codex')

/**
 * Env for a spawned CLI child. Under BERTH_TEST_HOME (clean first-run sim) the child's HOME/CODEX_HOME
 * are pointed at the test home so claude/coco/codex write their session files into the SAME dir
 * `storeRoots()` scans — closing the loop: a launched session surfaces in the otherwise-empty sidebar.
 * The binary was already resolved to an absolute path against the real home, so it's still found.
 * No-op when BERTH_TEST_HOME is unset.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!process.env.BERTH_TEST_HOME) return base
  return { ...base, HOME: process.env.BERTH_TEST_HOME, CODEX_HOME: codexHome() }
}

/**
 * Resolve a spawn cwd safely. A Berth project workspace dir (~/.berth/workspaces/<id>) is created
 * on demand — it legitimately may not exist yet. Any other path keeps the existsSync→homedir guard,
 * so a stale/deleted cwd doesn't crash the spawn. Used by BOTH launchFresh and resumeSession so a
 * workspace cwd is never silently swallowed into homedir() (the landmine in both paths). berthHome()
 * is read per-call (not captured at import) so BERTH_HOME-isolated instances + tests resolve right.
 */
export function ensureLaunchCwd(cwd: string | null | undefined): string {
  const workspacePrefix = join(berthHome(), 'workspaces')
  if (cwd && (cwd === workspacePrefix || cwd.startsWith(workspacePrefix + '/'))) {
    mkdirSync(cwd, { recursive: true })
    return cwd
  }
  return cwd && existsSync(cwd) ? cwd : homedir()
}

export function resumeArgv(cli: AgentCli, id: string): string[] {
  switch (cli) {
    case 'claude': return ['--resume', id]
    case 'codex':  return ['resume', '--no-alt-screen', id]
    // coco's `--resume string[="AUTO"]` is a Go pflag OPTIONAL-value flag: the id MUST be attached
    // with `=`. The space form `--resume <id>` binds --resume to its default ("AUTO" → auto-resume
    // most recent) and leaks <id> to coco's positional `[prompt]`, so coco submits the session id as
    // a visible first user turn ("Received: <uuid>"). The `=id` form resumes that exact session only.
    case 'coco':   return [`--resume=${id}`]
  }
}

export interface LaunchOpts { cols?: number; rows?: number }

export function resumeSession(s: LogicalSession, opts: LaunchOpts = {}): IPty {
  if (!s.resume) throw new Error(`session ${s.sessionId} has no resume target`)
  const { cli, id } = s.resume
  const cwd = ensureLaunchCwd(s.cwd)
  const bin = resolveAgentBinary(cli)
  if (cli === 'claude') ensureClaudeTrust(cwd)   // interactive PTY → trust dialog isn't auto-skipped
  return spawn(bin, resumeArgv(cli, id), {
    name: 'xterm-color', cols: opts.cols ?? 120, rows: opts.rows ?? 30, cwd, env: childEnv() as any,
  })
}

export interface FreshOpts {
  cwd: string; sessionId?: string; injectFile?: string
  initialPrompt?: string   // the user's first message (positional prompt)
  model?: string           // per-CLI default model (claude/codex only; coco has no --model flag)
  addDirs?: string[]; cols?: number; rows?: number
}

// Only task/execution launches submit a positional first turn. The manifest now rides a silent
// channel for every CLI (claude `--append-system-prompt-file`, codex + coco SessionStart hooks), so
// the positional prompt carries only the user's actual first message — never the context. A taskless
// "new session" stays idle (no positional) and still gets its context silently via the hook.
function positional(o: FreshOpts): string {
  return o.initialPrompt ?? ''
}

export function freshArgv(cli: AgentCli, o: FreshOpts): string[] {
  const dirs = (o.addDirs ?? []).flatMap(d => ['--add-dir', d])
  // `--add-dir <directories...>` is VARIADIC: it greedily consumes every following arg until the
  // next flag. The positional prompt must therefore never sit directly after it, or the prompt gets
  // eaten as a phantom directory and nothing is submitted (the launch just sits idle). `--`
  // terminates option parsing so the prompt is unambiguously positional, regardless of arg order.
  switch (cli) {
    case 'claude': return [
      ...(o.sessionId ? ['--session-id', o.sessionId] : []),
      '--dangerously-skip-permissions',                 // bypass-permissions: Berth-launched sessions run unattended
      ...(o.model ? ['--model', o.model] : []),
      ...(o.injectFile ? ['--append-system-prompt-file', o.injectFile] : []),
      ...dirs,
      ...(o.initialPrompt ? ['--', o.initialPrompt] : []),   // claude: manifest is a system prompt; user prompt is positional
    ]
    case 'coco': {
      const pos = positional(o)
      return [
        ...(o.sessionId ? ['--session-id', o.sessionId] : []),
        '--yolo',                                       // bypass tool permission checks
        ...dirs,
        ...(pos ? ['--', pos] : []),
      ]
    }
    case 'codex': {
      const pos = positional(o)
      return [
        ...(o.injectFile ? ['--profile', CODEX_BERTH_PROFILE, '--dangerously-bypass-hook-trust'] : []),
        '--dangerously-bypass-approvals-and-sandbox',   // bypass approvals + sandbox
        '--no-alt-screen',                              // inline TUI behaves better inside reattached web xterm
        ...(o.model ? ['--model', o.model] : []),
        ...dirs,
        ...(pos ? ['--', pos] : []),
      ]
    }
  }
}

// ─── Model B: claude stream-json spawn (returns a raw ChildProcess; the server wraps it in a
// StreamJsonDriver). Kept free of any server/ import so the pty→server dependency stays one-way. ───

// stream-json is bidirectional + long-lived: --input-format keeps the process alive across turns
// (user turns are written to stdin as NDJSON), --output-format emits NDJSON events, --verbose is
// REQUIRED with stream-json print mode, --include-partial-messages gives token streaming. Verified
// live against claude 2.1.186 (task smoke tests C4/C5/C6).
const CLAUDE_STREAM_FLAGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

function assertStreamCli(cli: AgentCli): void {
  if (cli !== 'claude') throw new Error(`Model B (stream-json) is claude-only for now, got ${cli}`)
}

export function freshArgvStream(cli: AgentCli, o: FreshOpts): string[] {
  assertStreamCli(cli)
  const dirs = (o.addDirs ?? []).flatMap(d => ['--add-dir', d])
  return [
    ...CLAUDE_STREAM_FLAGS,
    '--dangerously-skip-permissions',
    ...(o.sessionId ? ['--session-id', o.sessionId] : []),   // pre-mint id (no --resume) → <id>.jsonl
    ...(o.model ? ['--model', o.model] : []),
    ...(o.injectFile ? ['--append-system-prompt-file', o.injectFile] : []),   // manifest, same channel as Model A
    ...dirs,
    // NO positional prompt: the user's first turn is written to stdin as NDJSON by the driver.
  ]
}

export function resumeArgvStream(cli: AgentCli, id: string, o?: { model?: string }): string[] {
  assertStreamCli(cli)
  return [
    ...CLAUDE_STREAM_FLAGS,
    '--dangerously-skip-permissions',
    '--resume', id,   // resume the existing transcript; MUST NOT also pass --session-id (verified: conflicts)
    ...(o?.model ? ['--model', o.model] : []),
  ]
}

const STREAM_STDIO: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe']

export function launchFreshStream(o: FreshOpts): ChildProcess {
  const cwd = ensureLaunchCwd(o.cwd)
  const bin = resolveAgentBinary('claude')
  ensureClaudeTrust(cwd)
  const env = childEnv({ ...(process.env as any) })
  // detached:true → the child leads its own process group, so the registry's process.kill(-pid)
  // reaps the whole tree (MCP/sub-procs). Verified (task smoke test C1).
  return spawnChild(bin, freshArgvStream('claude', o), { cwd, env, detached: true, stdio: STREAM_STDIO })
}

export function resumeSessionStream(s: LogicalSession, o: { model?: string } = {}): ChildProcess {
  if (!s.resume) throw new Error(`session ${s.sessionId} has no resume target`)
  const { cli, id } = s.resume
  assertStreamCli(cli)
  const cwd = ensureLaunchCwd(s.cwd)
  const bin = resolveAgentBinary(cli)
  ensureClaudeTrust(cwd)
  return spawnChild(bin, resumeArgvStream(cli, id, o), { cwd, env: childEnv({ ...(process.env as any) }), detached: true, stdio: STREAM_STDIO })
}

// ─── Model B per-turn spawn for codex + coco (single-turn-then-exit: each user turn is a fresh
// process — `exec`/`--print` for the first turn, `resume` thereafter). The driver captures the
// session id from the stream (codex thread.started / coco system.init) and passes it as `resumeId`.
// Verified live against codex-cli 0.139.0 + coco 0.120.41 (task smoke tests). ───

export function codexTurnArgv(prompt: string, resumeId: string | null, o?: { model?: string }): string[] {
  // -C/--cd is NOT accepted on the `resume` subcommand (verified); cwd is set via the spawn option.
  const flags = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...(o?.model ? ['--model', o.model] : [])]
  return resumeId ? ['exec', 'resume', resumeId, ...flags, prompt] : ['exec', ...flags, prompt]
}

export function cocoTurnArgv(prompt: string, resumeId: string | null, sessionId: string): string[] {
  const flags = ['--print', '--output-format=stream-json', '--include-partial-messages', '-y']
  // coco honors a pre-minted --session-id on the fresh turn; resume uses the `--resume=<id>` = form.
  return resumeId ? [`--resume=${resumeId}`, ...flags, prompt] : ['--session-id', sessionId, ...flags, prompt]
}

export interface PerTurnOpts { cwd: string; sessionId?: string; model?: string; prompt: string; resumeId: string | null }

export function spawnPerTurn(cli: AgentCli, o: PerTurnOpts): ChildProcess {
  const cwd = ensureLaunchCwd(o.cwd)
  const bin = resolveAgentBinary(cli)
  const argv = cli === 'codex' ? codexTurnArgv(o.prompt, o.resumeId, { model: o.model })
    : cli === 'coco' ? cocoTurnArgv(o.prompt, o.resumeId, o.sessionId ?? '')
      : (() => { throw new Error(`per-turn stream not supported for ${cli}`) })()
  // stdin is 'ignore' (prompt rides argv) so codex never blocks on "Reading additional input from
  // stdin…"; detached:true makes the child a group leader for the registry's process.kill(-pid).
  return spawnChild(bin, argv, { cwd, env: childEnv({ ...(process.env as any) }), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function ensureCodexBerthHookProfile() {
  const home = codexHome()
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, `${CODEX_BERTH_PROFILE}.config.toml`), `# Generated by Berth. Loaded with: codex --profile ${CODEX_BERTH_PROFILE}
[[hooks.SessionStart]]
matcher = "startup"

[[hooks.SessionStart.hooks]]
type = "command"
command = "/bin/sh -c 'test -n \\"$BERTH_CONTEXT_FILE\\" && test -r \\"$BERTH_CONTEXT_FILE\\" && cat \\"$BERTH_CONTEXT_FILE\\" || true'"
timeout = 5
statusMessage = "Loading Berth context"
`)
}

export function launchFresh(cli: AgentCli, o: FreshOpts): IPty {
  const cwd = ensureLaunchCwd(o.cwd)
  const bin = resolveAgentBinary(cli)
  if (cli === 'claude') ensureClaudeTrust(cwd)   // interactive PTY → trust dialog isn't auto-skipped
  // codex's context hook rides `--dangerously-bypass-hook-trust`; on builds that lack the flag,
  // passing it aborts the launch. The flag probe can be slow (`codex --help`), so launch uses only
  // the warmed cache: if support is still unknown, start immediately without injection and keep the
  // probe warming in the background for the next launch.
  let opts = o
  if (cli === 'codex' && o.injectFile && codexHookTrustSupportOrWarm(bin) !== true) {
    opts = { ...o, injectFile: undefined }
  }
  const env = childEnv({ ...(process.env as any) })
  if (cli === 'codex' && opts.injectFile) {
    ensureCodexBerthHookProfile()
    env.BERTH_CONTEXT_FILE = opts.injectFile            // codex hook cats raw text as context
  }
  if (cli === 'coco' && opts.injectFile) {
    ensureCocoBerthHook()                               // register the session_start context hook (idempotent)
    env.BERTH_CONTEXT_FILE = writeCocoContextPayload(opts.injectFile)   // coco hook cats a JSON envelope
  }
  return spawn(bin, freshArgv(cli, opts), {
    name: 'xterm-color', cols: opts.cols ?? 120, rows: opts.rows ?? 30, cwd, env,
  })
}
