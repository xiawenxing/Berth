/**
 * UTF-8 locale fallback for spawned agent CLIs.
 *
 * When Berth is launched from a GUI context — the packaged Berth.app via Finder/LaunchServices, or an
 * App-Translocation copy — the process inherits NO locale env: `LANG`/`LC_*` are unset, so libc and
 * CoreFoundation fall back to the `C` locale, whose macOS system encoding is Mac OS Roman
 * (kCFStringEncodingMacRoman = 0, visible as `__CF_USER_TEXT_ENCODING=…:0:0`). Child CLIs
 * (claude/codex/coco) then mishandle Unicode: CJK width is miscalculated, and — most visibly — macOS
 * writes the legacy `«class TEXT»` clipboard flavor as the UTF-8 bytes reinterpreted as Mac Roman, so
 * pasting Berth output into apps that read that flavor (e.g. Feishu) yields mojibake like `Êú™ÂèëÈÄÅ`.
 *
 * Verified against the macOS pasteboard: an explicit UTF-8 `LC_CTYPE` overrides the inherited
 * Mac-Roman `__CF_USER_TEXT_ENCODING`, so injecting one when none is present is sufficient. The packaged
 * app also sets this at launch via `LSEnvironment` (electron-builder.yml); this helper covers the CLI
 * server path and is belt-and-suspenders for every PTY/child spawn whose parent env still lacks UTF-8.
 */
const UTF8 = /utf-?8/i

/** True when the env already requests a UTF-8 locale via any of LC_ALL / LC_CTYPE / LANG. */
export function hasUtf8Locale(env: NodeJS.ProcessEnv): boolean {
  return UTF8.test(env.LC_ALL ?? '') || UTF8.test(env.LC_CTYPE ?? '') || UTF8.test(env.LANG ?? '')
}

/**
 * Return `env` with a UTF-8 `LC_CTYPE` injected when it lacks any UTF-8 locale, so spawned CLIs handle
 * Unicode correctly regardless of how Berth was launched. Returns a new object when it injects and the
 * input unchanged (same reference) when a UTF-8 locale is already present — never clobbers a user's
 * explicit UTF-8 locale, and never mutates the input.
 */
export function withUtf8Locale(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (hasUtf8Locale(env)) return env
  // macOS ships en_US.UTF-8 universally; Linux's portable choice is C.UTF-8. (Windows: text encoding
  // isn't locale-driven, so this is a harmless no-op there.)
  const fallback = process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8'
  return { ...env, LC_CTYPE: fallback }
}
