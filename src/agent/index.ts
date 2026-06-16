import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentBinary } from '../pty/binaries'
import { HEADLESS_CLIS } from '../data/agent-config'
import { berthAgentCwd } from '../paths'
import type { AgentCli } from '../types'
import { titleInputFromTranscript } from './transcript'
import { classifyAgentFailure, looksLikeAuthBlock, InternalAgentBlocked, isInternalAgentBlocked } from './agent-failure'
const BUF = 8 * 1024 * 1024
const STDERR_CAP = 64 * 1024

export interface BerthAgent { cli: AgentCli; model?: string }

function ensureAgentCwd(): string {
  const cwd = berthAgentCwd()
  mkdirSync(cwd, { recursive: true })
  return cwd
}

/**
 * Spawn a headless CLI, stream stderr, and resolve with stdout (when captured). On failure throw a
 * typed `InternalAgentBlocked` classified into auth/timeout/other — so callers can give the user an
 * actionable error instead of a silent hang. stdin is `/dev/null` for BOTH CLIs (codex otherwise
 * waits for stdin; claude `-p` reads its prompt from argv). We **kill early** the moment an auth
 * signature shows up in stderr, rather than waiting the full timeout — that is what makes it fast.
 */
function runHeadless(bin: string, args: string[], opts: { cli: AgentCli; timeoutMs: number; captureStdout: boolean }): Promise<string> {
  const { cli, timeoutMs, captureStdout } = opts
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: ensureAgentCwd(), stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn() }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(() => reject(new InternalAgentBlocked('timeout', cli, stderr.trim().slice(-300))))
    }, timeoutMs)
    if (captureStdout) child.stdout?.on('data', d => { if (stdout.length < BUF) stdout += d.toString() })
    child.stderr?.on('data', d => {
      if (stderr.length < STDERR_CAP) stderr += d.toString()
      if (looksLikeAuthBlock(cli, stderr)) {
        child.kill('SIGKILL')
        settle(() => reject(new InternalAgentBlocked('auth', cli, stderr.trim().slice(-300))))
      }
    })
    child.on('error', e => settle(() => reject(e)))
    child.on('close', code => settle(() => {
      if (code === 0) return resolve(stdout)
      reject(new InternalAgentBlocked(classifyAgentFailure(cli, stderr, false), cli, stderr.trim().slice(-300)))
    }))
  })
}

/** claude headless: `claude -p` prints a reply-only stdout. An empty model → claude's own default. */
async function runClaude(bin: string, prompt: string, model: string | undefined, timeoutMs: number): Promise<string> {
  const args = ['-p', prompt, '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])]
  const stdout = await runHeadless(bin, args, { cli: 'claude', timeoutMs, captureStdout: true })
  return stdout.trim()
}

/** codex headless: stdout carries banner/log noise, so we capture the final reply via
 *  `-o <file>` (--output-last-message) and read it back. Runs in a throwaway dir with
 *  `--skip-git-repo-check` so it works regardless of the server's cwd. Empty model → codex default.
 *  IMPORTANT: codex must be spawned with stdin = /dev/null (`stdio[0]='ignore'`). A piped/non-TTY
 *  stdin makes codex wait to read "additional input from stdin" and append it as a `<stdin>` block,
 *  which derails the one-shot (it exits 0 having written nothing). execFile gives a pipe stdin, so
 *  we use spawn with an ignored stdin instead. */
async function runCodex(bin: string, prompt: string, model: string | undefined, timeoutMs: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'berth-codex-'))
  const outFile = join(dir, 'reply.txt')
  const args = [
    'exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--color', 'never',
    ...(model ? ['-m', model] : []), '-o', outFile, prompt,
  ]
  try {
    // stdout carries banner noise; the real reply is read from outFile. runHeadless still throws a
    // typed InternalAgentBlocked on auth/timeout/non-zero exit (using captured stderr).
    await runHeadless(bin, args, { cli: 'codex', timeoutMs, captureStdout: false })
    return readFileSync(outFile, 'utf8').trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Run the internal management agent headlessly. Returns its text reply. Defaults to claude. */
export async function runAgent(prompt: string, opts: { cli?: AgentCli; model?: string; timeoutMs?: number } = {}): Promise<string> {
  const cli = opts.cli ?? 'claude'
  if (!HEADLESS_CLIS.includes(cli)) throw new Error(`cli "${cli}" cannot run as the berth agent`)
  const bin = resolveAgentBinary(cli)
  const model = opts.model || undefined           // empty string → use the CLI's own default
  const timeoutMs = opts.timeoutMs ?? 60000
  switch (cli) {
    case 'codex': return runCodex(bin, prompt, model, timeoutMs)
    default:      return runClaude(bin, prompt, model, timeoutMs)
  }
}

/**
 * Run the agent with one transient-failure retry (the CLI's own default model), but NEVER retry an
 * auth block — re-running an unauthenticated CLI just doubles the wait and re-throws. Auth (and any
 * other failure from the retry) propagates as `InternalAgentBlocked` so the endpoint can surface it.
 */
async function runAgentWithFallback(prompt: string, primary: { cli: AgentCli; model?: string; timeoutMs: number }, fallback: { cli: AgentCli; timeoutMs: number }): Promise<string> {
  try {
    return await runAgent(prompt, primary)
  } catch (e) {
    if (isInternalAgentBlocked(e) && e.kind === 'auth') throw e
    return runAgent(prompt, fallback)
  }
}

/** Generate a concise human title from a raw session transcript head. */
export async function generateTitle(transcriptHead: string, agent?: BerthAgent): Promise<string> {
  const sampled = titleInputFromTranscript(transcriptHead)
  if (!sampled) return ''
  const prompt =
    `Below are sampled clues from a coding-assistant session transcript. ` +
    `They may include user requests, assistant progress, and tool/grep/command/path clues. ` +
    `Reply with ONLY a concise title of at most 8 words, in the session's own language, ` +
    `describing what the session actually worked on. Do not title it from only the first user query ` +
    `when process clues show a more specific outcome. No surrounding quotes, no trailing punctuation.\n\n---\n` +
    sampled
  const cli = agent?.cli ?? 'claude'
  // No agent configured at all → preserve the historical claude+haiku default. A configured agent
  // carries its own model (possibly empty = the CLI's own default), so don't force a claude model.
  const model = agent ? (agent.model || undefined) : 'claude-haiku-4-5'
  let out = await runAgentWithFallback(prompt, { cli, model, timeoutMs: 45000 }, { cli, timeoutMs: 60000 })
  out = (out.split('\n').find(l => l.trim()) ?? '').replace(/^["'""\s]+|["'""\s]+$/g, '').slice(0, 100)
  return out
}

/** Summarize a task's context doc into a short progress snapshot (the DB `progress` field). */
export async function generateProgressSummary(docText: string, summaryPrompt: string, agent?: BerthAgent): Promise<string> {
  const prompt = summaryPrompt + '\n\n---\n' + docText.slice(0, 4000)
  const cli = agent?.cli ?? 'claude'
  const model = agent ? (agent.model || undefined) : 'claude-haiku-4-5'
  let out = await runAgentWithFallback(prompt, { cli, model, timeoutMs: 45000 }, { cli, timeoutMs: 60000 })
  out = out.split('\n').map(l => l.trim()).filter(Boolean).join(' ').replace(/^["'""\s]+|["'""\s]+$/g, '').slice(0, 500)
  return out
}
