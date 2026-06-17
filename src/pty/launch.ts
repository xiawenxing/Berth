import { spawn, type IPty } from 'node-pty'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentBinary, codexSupportsHookTrust } from './binaries'
import { ensureClaudeTrust } from './trust'
import { ensureCocoBerthHook, writeCocoContextPayload } from './coco-hook'
import { berthHome } from '../paths'
import type { AgentCli, LogicalSession } from '../types'

const CODEX_BERTH_PROFILE = 'berth-launch'
const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

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
    case 'codex':  return ['resume', id]
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
    name: 'xterm-color', cols: opts.cols ?? 120, rows: opts.rows ?? 30, cwd, env: process.env as any,
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
        ...(o.model ? ['--model', o.model] : []),
        ...dirs,
        ...(pos ? ['--', pos] : []),
      ]
    }
  }
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
  // passing it aborts the launch. Drop context injection for this launch rather than crash — the
  // session still starts, just without the silent SessionStart context.
  let opts = o
  if (cli === 'codex' && o.injectFile && !codexSupportsHookTrust(bin)) {
    opts = { ...o, injectFile: undefined }
  }
  const env = { ...(process.env as any) }
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
