import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentBinary } from '../pty/binaries'
import { HEADLESS_CLIS } from '../data/agent-config'
import { berthAgentCwd } from '../paths'
import type { AgentCli } from '../types'
import { extractTitleContext, extractUserGist } from './transcript'
const exec = promisify(execFile)
const BUF = 8 * 1024 * 1024

export interface BerthAgent { cli: AgentCli; model?: string }

function ensureAgentCwd(): string {
  const cwd = berthAgentCwd()
  mkdirSync(cwd, { recursive: true })
  return cwd
}

/** claude headless: `claude -p` prints a reply-only stdout. An empty model → claude's own default. */
async function runClaude(bin: string, prompt: string, model: string | undefined, timeoutMs: number): Promise<string> {
  const args = ['-p', prompt, '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])]
  const { stdout } = await exec(bin, args, { cwd: ensureAgentCwd(), timeout: timeoutMs, maxBuffer: BUF })
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { cwd: ensureAgentCwd(), stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr?.on('data', d => { if (stderr.length < 8192) stderr += d.toString() })
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('codex timed out')) }, timeoutMs)
      child.on('error', e => { clearTimeout(timer); reject(e) })
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`codex exited ${code}: ${stderr.slice(-300)}`))
      })
    })
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

/** Generate a concise human title from a raw session transcript head. */
export async function generateTitle(transcriptHead: string, agent?: BerthAgent): Promise<string> {
  const sampled = extractTitleContext(transcriptHead) || extractUserGist(transcriptHead) || transcriptHead.slice(0, 5000)
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
  let out = await runAgent(prompt, { cli, model, timeoutMs: 45000 }).catch(async () => runAgent(prompt, { cli, timeoutMs: 60000 }))
  out = (out.split('\n').find(l => l.trim()) ?? '').replace(/^["'""\s]+|["'""\s]+$/g, '').slice(0, 100)
  return out
}

/** Summarize a task's context doc into a short progress snapshot (the DB `progress` field). */
export async function generateProgressSummary(docText: string, summaryPrompt: string, agent?: BerthAgent): Promise<string> {
  const prompt = summaryPrompt + '\n\n---\n' + docText.slice(0, 4000)
  const cli = agent?.cli ?? 'claude'
  const model = agent ? (agent.model || undefined) : 'claude-haiku-4-5'
  let out = await runAgent(prompt, { cli, model, timeoutMs: 45000 }).catch(async () => runAgent(prompt, { cli, timeoutMs: 60000 }))
  out = out.split('\n').map(l => l.trim()).filter(Boolean).join(' ').replace(/^["'""\s]+|["'""\s]+$/g, '').slice(0, 500)
  return out
}
