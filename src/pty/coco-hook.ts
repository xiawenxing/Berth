import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'

// coco's authoritative config (the file `coco config edit` opens). Hooks live in a flat `hooks:`
// array of `{ type, command, matchers: [{ event }] }` — confirmed against `coco doc hooks`.
const traeConfigPath = () => join(homedir(), '.trae', 'traecli.yaml')

// A `session_start` hook that prints the Berth manifest as the agent's additional context. coco
// injects `hookSpecificOutput.additionalContext` from a session_start hook as a `<system-reminder>`
// into the next model call (per `coco doc hooks`) — the silent channel that lets the manifest ride
// alongside, not inside, the user's first prompt (same role as claude `--append-system-prompt-file`
// and the codex SessionStart hook).
//
// It no-ops unless `$BERTH_CONTEXT_FILE` points at a readable file, so it is inert for every coco
// session the owner starts by hand — only Berth-launched sessions set that env var. The payload file
// is pre-encoded JSON (coco treats non-JSON stdout as empty), so the hook itself only needs `cat` —
// no jq/python dependency in the hook's minimal `sh -c` environment. `BERTH_CONTEXT_FILE` is the
// idempotency marker: we never add a second copy of this hook.
const HOOK_COMMAND =
  'test -n "$BERTH_CONTEXT_FILE" && test -r "$BERTH_CONTEXT_FILE" && cat "$BERTH_CONTEXT_FILE" || true'

const isBerthHook = (h: unknown): boolean =>
  !!h && typeof (h as any).command === 'string' && (h as any).command.includes('BERTH_CONTEXT_FILE')

/**
 * Idempotently register Berth's session_start context hook in coco's global config, preserving every
 * existing hook (the owner's Flux Island integration etc.). Safe by construction:
 *  - if the config exists but can't be parsed (or isn't a mapping), we leave it untouched rather than
 *    risk clobbering the owner's mcp_servers/model/hooks with a Berth-only file;
 *  - if our hook is already present, we don't write at all.
 */
export function ensureCocoBerthHook(configPath = traeConfigPath()): void {
  let doc: any
  if (existsSync(configPath)) {
    try { doc = parse(readFileSync(configPath, 'utf8')) }
    catch { return }                                   // unparseable — don't overwrite the owner's config
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return
  } else {
    doc = {}
  }

  const hooks: any[] = Array.isArray(doc.hooks) ? doc.hooks : []
  if (hooks.some(isBerthHook)) return                  // already registered

  hooks.push({ type: 'command', command: HOOK_COMMAND, matchers: [{ event: 'session_start' }] })
  doc.hooks = hooks
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, stringify(doc))
}

/**
 * Pre-encode the manifest as a coco hook stdout payload (`{hookSpecificOutput:{additionalContext}}`)
 * so the hook only has to `cat` it. Returns the payload path to point `$BERTH_CONTEXT_FILE` at.
 */
export function writeCocoContextPayload(injectFilePath: string): string {
  const text = readFileSync(injectFilePath, 'utf8')
  const payloadPath = injectFilePath.endsWith('.txt')
    ? injectFilePath.slice(0, -4) + '.coco.json'
    : injectFilePath + '.coco.json'
  writeFileSync(payloadPath, JSON.stringify({ hookSpecificOutput: { additionalContext: text } }))
  return payloadPath
}
