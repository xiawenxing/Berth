import { spawn, type IPty } from 'node-pty'
import { spawn as spawnChild, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAgentBinary, codexHookTrustSupportOrWarm } from './binaries'
import { gateArgvForBinary, stripAllDegradable } from './flag-gate'
import { ensureClaudeTrust, ensureCodexTrust } from './trust'
import { ensureCocoBerthHook, writeCocoContextPayload } from './coco-hook'
import { agentSpawnEnv } from './agent-env'
import { ensureAgentBerthShim } from './agent-shim'
import { getLocalServerAddress } from '../server-address'
import { withUtf8Locale } from './locale'
import { berthHome } from '../paths'
import type { AgentCli, LogicalSession } from '../types'

const CODEX_BERTH_PROFILE = 'berth-launch'
const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

/** Env for a Berth-spawned agent: PATH gets the berth-shim dir; BERTH_PORT/HOST point at our server.
 *  Wrapped in withUtf8Locale so every spawn path also gets a UTF-8 LANG/LC_* — a GUI/C-locale launch
 *  otherwise makes the agent write a legacy Mac-Roman pasteboard flavor (copy→Feishu mojibake). This
 *  is the single chokepoint all launch/resume/per-turn spawns flow through, so centralizing the
 *  locale here covers them all (the clipboard branch wrapped each call site; this is the DRY merge). */
function spawnEnv(sessionId?: string): NodeJS.ProcessEnv {
  const addr = getLocalServerAddress()
  if (!addr) return withUtf8Locale(agentSpawnEnv(process.env, null, sessionId))
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'berth.mjs')
  const binDir = ensureAgentBerthShim(cliEntry)
  return withUtf8Locale(agentSpawnEnv(process.env, { port: addr.port, host: addr.host, binDir }, sessionId))
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

/**
 * Drop any version-sensitive flag the resolved binary doesn't support, so an older/newer CLI doesn't
 * abort the launch on an "unexpected argument". Applied at EVERY spawn site (TUI + stream, fresh +
 * resume + per-turn). Confirmed-unsupported flags only — see flag-gate.ts. Logs what it drops.
 */
function gated(cli: AgentCli, bin: string, argv: string[]): string[] {
  const { argv: out, dropped } = gateArgvForBinary(cli, bin, argv)
  if (dropped.length) console.warn(`[berth] ${cli}: dropped flag(s) not supported by this build: ${dropped.join(' ')}`)
  return out
}

export interface LaunchOpts { cols?: number; rows?: number }

export function resumeSession(s: LogicalSession, opts: LaunchOpts = {}): IPty {
  if (!s.resume) throw new Error(`session ${s.sessionId} has no resume target`)
  const { cli, id } = s.resume
  const cwd = ensureLaunchCwd(s.cwd)
  const bin = resolveAgentBinary(cli)
  // interactive PTY → neither CLI auto-skips its workspace-trust dialog; seed trust so the
  // unattended launch isn't blocked on it (the auto-submitted turn would otherwise never fire).
  if (cli === 'claude') ensureClaudeTrust(cwd)
  else if (cli === 'codex') ensureCodexTrust(cwd)
  return spawn(bin, gated(cli, bin, resumeArgv(cli, id)), {
    name: 'xterm-color', cols: opts.cols ?? 120, rows: opts.rows ?? 30, cwd, env: spawnEnv(s.sessionId) as any,
  })
}

export interface FreshOpts {
  cwd: string; sessionId?: string; injectFile?: string
  callbackToken?: string   // channel A: = intent id; emitted to the hook as $BERTH_LAUNCH_TOKEN, names the
                           // <token>.json drop. NOT diag's browser-side launchToken (a different correlation id).
  initialPrompt?: string   // the user's first message (positional prompt)
  model?: string           // per-CLI default model (claude/codex only; coco has no --model flag)
  safeMode?: boolean       // ON → omit the approval-bypass flag (interactive Model A only). Default/undefined = max permission.
  addDirs?: string[]; cols?: number; rows?: number
}

// The manifest rides a silent channel for every CLI (claude `--append-system-prompt-file`, codex +
// coco SessionStart hooks), so the positional prompt only ever carries the user's actual first message
// — never the context. Model A first-turn delivery is UNIFORM: all three CLIs take the native positional
// `[PROMPT]`, which each CLI queues and auto-submits once ITS OWN composer is ready. This is the most
// reliable Model-A option (PTY-probed) — far better than the reverted claude-only "type the turn after
// the bracketed-paste readiness marker" path: claude emits that marker ~0.4s in during its welcome
// banner, long before the composer accepts input, so typing then dropped the turn (the "概率性 query 不
// 自动发送" bug). claude's trust dialog — the original reason its positional sometimes vanished — is
// pre-seeded (pty/trust.ts). CAVEAT: claude's interactive auto-submit still has a rare slow-startup miss
// (probe ~3/4); the only race-free delivery is Model B (stream-json), where the turn rides stdin NDJSON.
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
      ...(o.safeMode ? [] : ['--dangerously-skip-permissions']),  // bypass-permissions unless safe mode; Berth-launched sessions run unattended
      ...(o.model ? ['--model', o.model] : []),
      ...(o.injectFile ? ['--append-system-prompt-file', o.injectFile] : []),
      ...dirs,
      ...(o.initialPrompt ? ['--', o.initialPrompt] : []),   // claude: manifest is a system prompt; user prompt is positional
    ]
    case 'coco': {
      const pos = positional(o)
      return [
        ...(o.sessionId ? ['--session-id', o.sessionId] : []),
        ...(o.safeMode ? [] : ['--yolo']),                        // bypass tool permission checks unless safe mode
        ...dirs,
        ...(pos ? ['--', pos] : []),
      ]
    }
    case 'codex': {
      const pos = positional(o)
      return [
        ...(o.injectFile ? ['--profile', CODEX_BERTH_PROFILE, '--dangerously-bypass-hook-trust'] : []),
        // safe mode must EXPLICITLY set approval+sandbox: a user's codex config can pin
        // approval_policy="never"/sandbox_mode="danger-full-access" globally, so merely omitting the
        // bypass flag still launches in YOLO mode (verified). The -a/-s CLI flags override config.
        ...(o.safeMode
          ? ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write']
          : ['--dangerously-bypass-approvals-and-sandbox']),
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
  const env = spawnEnv(o.sessionId) as any
  // detached:true → the child leads its own process group, so the registry's process.kill(-pid)
  // reaps the whole tree (MCP/sub-procs). Verified (task smoke test C1).
  return spawnChild(bin, gated('claude', bin, freshArgvStream('claude', o)), { cwd, env, detached: true, stdio: STREAM_STDIO })
}

export function resumeSessionStream(s: LogicalSession, o: { model?: string } = {}): ChildProcess {
  if (!s.resume) throw new Error(`session ${s.sessionId} has no resume target`)
  const { cli, id } = s.resume
  assertStreamCli(cli)
  const cwd = ensureLaunchCwd(s.cwd)
  const bin = resolveAgentBinary(cli)
  ensureClaudeTrust(cwd)
  return spawnChild(bin, gated(cli, bin, resumeArgvStream(cli, id, o)), { cwd, env: spawnEnv(s.sessionId) as any, detached: true, stdio: STREAM_STDIO })
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

export interface PerTurnOpts { cwd: string; sessionId?: string; model?: string; prompt: string; resumeId: string | null; injectFile?: string }

export function spawnPerTurn(cli: AgentCli, o: PerTurnOpts): ChildProcess {
  const cwd = ensureLaunchCwd(o.cwd)
  const bin = resolveAgentBinary(cli)
  if (cli === 'codex') ensureCodexTrust(cwd)   // `codex exec` also refuses an untrusted dir
  const env = spawnEnv(o.sessionId) as any
  if (cli === 'coco' && o.injectFile) {
    ensureCocoBerthHook()
    env.BERTH_CONTEXT_FILE = writeCocoContextPayload(o.injectFile)
  }
  const argv = cli === 'codex' ? codexTurnArgv(o.prompt, o.resumeId, { model: o.model })
    : cli === 'coco' ? cocoTurnArgv(o.prompt, o.resumeId, o.sessionId ?? '')
      : (() => { throw new Error(`per-turn stream not supported for ${cli}`) })()
  // stdin is 'ignore' (prompt rides argv) so codex never blocks on "Reading additional input from
  // stdin…"; detached:true makes the child a group leader for the registry's process.kill(-pid).
  return spawnChild(bin, gated(cli, bin, argv), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Directory under BERTH_HOME where SessionStart hooks drop their launch-callback envelopes. */
export function codexCallbackDir(): string {
  return join(berthHome(), 'launch-callbacks')
}

export function ensureCodexBerthHookProfile() {
  const home = codexHome()
  mkdirSync(home, { recursive: true })
  // The hook does two things, order matters:
  //   1. Consume stdin (codex's SessionStart envelope: {session_id, cwd, hook_event_name, ...}) and
  //      drop it RAW to $BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json — Berth parses it in TS (no jq
  //      in the hook's narrow PATH). The file NAME carries the launch token → exact intent match.
  //   2. cat $BERTH_CONTEXT_FILE to STDOUT — codex injects hook stdout as context (must not regress).
  // Both env vars are injected by launchFresh. If the callback dir/token is unset (a non-Berth codex
  // run reusing this profile — shouldn't happen, but be safe), the drop is skipped and only context
  // injection runs.
  writeFileSync(join(home, `${CODEX_BERTH_PROFILE}.config.toml`), `# Generated by Berth. Loaded with: codex --profile ${CODEX_BERTH_PROFILE}
[[hooks.SessionStart]]
matcher = "startup"

[[hooks.SessionStart.hooks]]
type = "command"
command = "/bin/sh -c 'payload=$(cat); if [ -n \\"$BERTH_CALLBACK_DIR\\" ] && [ -n \\"$BERTH_LAUNCH_TOKEN\\" ]; then mkdir -p \\"$BERTH_CALLBACK_DIR\\"; printf %s \\"$payload\\" > \\"$BERTH_CALLBACK_DIR/$BERTH_LAUNCH_TOKEN.json\\"; fi; test -n \\"$BERTH_CONTEXT_FILE\\" && test -r \\"$BERTH_CONTEXT_FILE\\" && cat \\"$BERTH_CONTEXT_FILE\\" || true'"
timeout = 5
statusMessage = "Loading Berth context"
`)
}

export function launchFresh(cli: AgentCli, o: FreshOpts, flags: { minimal?: boolean } = {}): IPty {
  const cwd = ensureLaunchCwd(o.cwd)
  const bin = resolveAgentBinary(cli)
  if (cli === 'claude') ensureClaudeTrust(cwd)   // interactive PTY → trust dialog isn't auto-skipped
  else if (cli === 'codex') ensureCodexTrust(cwd) // ditto: codex's dir-trust dialog blocks the unattended turn
  // codex's context hook rides `--dangerously-bypass-hook-trust`; on builds that lack the flag,
  // passing it aborts the launch. The flag probe can be slow (`codex --help`), so launch uses only
  // the warmed cache: if support is still unknown, start immediately without injection and keep the
  // probe warming in the background for the next launch.
  // `minimal` is the reactive last-resort retry (see TuiDriver respawn): drop context injection too,
  // and force-strip every degradable flag below — bare bones to maximize the chance the session starts.
  let opts = flags.minimal ? { ...o, injectFile: undefined } : o
  if (cli === 'codex' && opts.injectFile && codexHookTrustSupportOrWarm(bin) !== true) {
    opts = { ...opts, injectFile: undefined }
  }
  const env = spawnEnv(o.sessionId) as any
  if (cli === 'codex' && opts.injectFile) {
    ensureCodexBerthHookProfile()
    env.BERTH_CONTEXT_FILE = opts.injectFile            // codex hook cats raw text as context
    // Channel A: the SessionStart hook drops codex's envelope (real session_id) to <token>.json so
    // Berth binds the task↔session edge the moment codex starts — token = the launch intent id.
    // sessionId is only pre-minted for claude/coco; codex never gets one until the SessionStart
    // envelope arrives via the hook — so this check is always true here, kept explicit for clarity.
    if (opts.sessionId === undefined && opts.callbackToken) {
      env.BERTH_LAUNCH_TOKEN = opts.callbackToken
      env.BERTH_CALLBACK_DIR = codexCallbackDir()
    }
  }
  if (cli === 'coco' && opts.injectFile) {
    ensureCocoBerthHook()                               // register the session_start context hook (idempotent)
    env.BERTH_CONTEXT_FILE = writeCocoContextPayload(opts.injectFile)   // coco hook cats a JSON envelope
  }
  const argv = flags.minimal ? stripAllDegradable(cli, freshArgv(cli, opts)).argv : gated(cli, bin, freshArgv(cli, opts))
  return spawn(bin, argv, {
    name: 'xterm-color', cols: opts.cols ?? 120, rows: opts.rows ?? 30, cwd, env,
  })
}
