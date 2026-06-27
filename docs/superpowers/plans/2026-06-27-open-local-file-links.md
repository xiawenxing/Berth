# Open Local File Hyperlinks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking a local-file hyperlink (`file://`, bare absolute/`~` path, or a custom scheme like `obsidian://`) in Berth's rendered markdown open it with the host's default app, in both the browser and Electron modes.

**Architecture:** Frontend intercepts clicks on local-file links in the `Markdown` component, `preventDefault`s, and POSTs the raw href to a new `POST /api/open-local` endpoint. The backend (which runs on the user's own machine) normalizes the target and opens it via the OS command (`open`/`xdg-open`/`start`). Pure helpers (`resolveOpenTarget`, `openCommand`, `isAllowedOrigin`, `isLocalHref`, `handleMarkdownClick`) are split out so logic is unit-tested without spawning processes or a real browser.

**Tech Stack:** Node + Express (`src/server`), vitest (root `test/`), React + marked + DOMPurify (`web/src`), vitest + jsdom (`web/src`).

**Spec:** `docs/superpowers/specs/2026-06-27-open-local-file-links-design.md`

---

## File Structure

- **Create** `src/server/open-local.ts` — pure helpers: `resolveOpenTarget()`, `openCommand()`, `isAllowedOrigin()`.
- **Create** `test/open-local.test.ts` — unit tests for those pure helpers.
- **Modify** `src/server/api.ts` — add `POST /api/open-local` route wiring the helpers + `execFile`.
- **Modify** `test/api.test.ts` — route-level tests (mocked `execFile`, origin/validation/not-found).
- **Create** `web/src/lib/local-links.ts` — pure `isLocalHref()`.
- **Create** `web/src/lib/local-links.test.ts` — unit tests for `isLocalHref()`.
- **Modify** `web/src/lib/api.ts` — add `openLocal()` client method.
- **Modify** `web/src/components/Markdown.tsx` — export `handleMarkdownClick()`, wire container `onClick`.
- **Modify** `web/src/components/Markdown.test.ts` — tests for `handleMarkdownClick()`.

Conventions confirmed from the codebase:
- Routes: `api.post('/x', (req,res)=>{ ... res.status(400).json({error}) ... res.json({ok:true}) })`; `api` is `Router()` in `src/server/api.ts:151`, mounted at `/api` in `src/server/index.ts:43`.
- `execFile(bin, args, opts, cb)` callback style (see `src/server/api.ts:221`).
- Backend tests boot the real app via `createApp().listen(0)` and `fetch` it; `execFile` is mocked with `vi.hoisted` + `vi.mock('node:child_process', …)` (see `test/api.test.ts:8-13,168-169`).
- Web API calls go through `send('POST', '/api/…', body)` in `web/src/lib/api.ts:105`.
- Web tests run under jsdom (`web/vitest.config.ts:9`); **no** `@testing-library` — test DOM directly.

**Run all tests:** backend from repo root `npx vitest run <file>`; web from `web/` via `npx vitest run <file>`.

---

### Task 1: Backend pure helpers (`src/server/open-local.ts`)

**Files:**
- Create: `src/server/open-local.ts`
- Test: `test/open-local.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/open-local.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveOpenTarget, openCommand, isAllowedOrigin } from '../src/server/open-local'

describe('resolveOpenTarget', () => {
  it('decodes a file:// URL to a filesystem path', () => {
    expect(resolveOpenTarget('file:///Users/a%20b/c.md')).toEqual({ kind: 'file', value: '/Users/a b/c.md' })
  })
  it('expands a ~ home path', () => {
    expect(resolveOpenTarget('~/notes/x.md')).toEqual({ kind: 'file', value: join(homedir(), 'notes/x.md') })
  })
  it('keeps a bare absolute path', () => {
    expect(resolveOpenTarget('/Users/me/x.md')).toEqual({ kind: 'file', value: '/Users/me/x.md' })
  })
  it('passes a custom scheme through untouched', () => {
    expect(resolveOpenTarget('obsidian://open?vault=v&file=n')).toEqual({ kind: 'scheme', value: 'obsidian://open?vault=v&file=n' })
  })
  it('throws on an unsupported target (relative / http)', () => {
    expect(() => resolveOpenTarget('relative/path')).toThrow()
    expect(() => resolveOpenTarget('https://example.com')).toThrow()
  })
})

describe('openCommand', () => {
  it('uses `open` on macOS', () => {
    expect(openCommand('darwin', '/x/y')).toEqual({ bin: 'open', args: ['/x/y'] })
  })
  it('uses `xdg-open` on linux', () => {
    expect(openCommand('linux', '/x/y')).toEqual({ bin: 'xdg-open', args: ['/x/y'] })
  })
  it('uses `start` via cmd on windows', () => {
    expect(openCommand('win32', 'C:\\x')).toEqual({ bin: 'cmd', args: ['/c', 'start', '', 'C:\\x'] })
  })
})

describe('isAllowedOrigin', () => {
  it('allows a missing origin (non-browser client)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
  })
  it('allows loopback origins on any port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:7777')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
  })
  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false)
  })
  it('rejects an unparseable origin', () => {
    expect(isAllowedOrigin('not a url')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/open-local.test.ts`
Expected: FAIL — `Cannot find module '../src/server/open-local'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/open-local.ts`:

```typescript
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OpenTarget = { kind: 'file'; value: string } | { kind: 'scheme'; value: string }

/**
 * Normalize a clicked local-link href into something the OS open-command can launch.
 * - `file://…`        → decoded filesystem path  (kind: 'file')
 * - `~/…`             → $HOME-expanded path       (kind: 'file')
 * - `/…`              → absolute path as-is       (kind: 'file')
 * - `scheme://…`      → passed through untouched  (kind: 'scheme')  e.g. obsidian://, vscode://
 * Anything else (relative path, http/https) is not a local target → throws.
 */
export function resolveOpenTarget(target: string): OpenTarget {
  if (target.startsWith('file://')) return { kind: 'file', value: fileURLToPath(target) }
  if (target === '~' || target.startsWith('~/')) return { kind: 'file', value: join(homedir(), target.slice(1).replace(/^\/+/, '')) }
  if (target.startsWith('/') && !target.startsWith('//')) return { kind: 'file', value: target }
  if (/^https?:\/\//i.test(target)) throw new Error('http(s) is not a local target')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) return { kind: 'scheme', value: target }
  throw new Error(`unsupported open target: ${target}`)
}

/** Platform open-command as { bin, args } — args is an array (execFile, no shell → no injection). */
export function openCommand(platform: NodeJS.Platform, value: string): { bin: string; args: string[] } {
  if (platform === 'darwin') return { bin: 'open', args: [value] }
  if (platform === 'win32') return { bin: 'cmd', args: ['/c', 'start', '', value] }
  return { bin: 'xdg-open', args: [value] }
}

/**
 * CSRF guard: only the local Berth UI may call open-local. A missing Origin means a non-browser
 * client (curl/Electron) — allowed; a present Origin must be loopback (Berth only ever serves on
 * 127.0.0.1/localhost). A drive-by page on another origin is rejected.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/open-local.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/open-local.ts test/open-local.test.ts
git commit -m "feat(server): pure helpers to resolve+open local-file link targets"
```

---

### Task 2: Backend route `POST /api/open-local` (`src/server/api.ts`)

**Files:**
- Modify: `src/server/api.ts` (import helpers + `existsSync`; add route near other POST routes, e.g. after `/pick-folder`)
- Test: `test/api.test.ts` (add a `describe('open-local API', …)` block)

- [ ] **Step 1: Write the failing test**

Append to `test/api.test.ts` (the file already mocks `execFile` as `mockExecFile` and exposes `listen()` + `createApp`):

```typescript
describe('open-local API', () => {
  beforeEach(() => { mockExecFile.mockReset() })

  // local header const (avoid shadowing the module-level `J`): JSON + loopback Origin.
  const HDR = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:7777' }

  it('opens a file target via the platform command and returns ok', async () => {
    // file existence is checked for kind:'file' — use a path we know exists: this test file's dir.
    const existing = process.cwd()
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: any, cb: Function) => cb(null, '', ''))
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: existing }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [bin, args] = mockExecFile.mock.calls[0]
    if (process.platform === 'darwin') { expect(bin).toBe('open'); expect(args).toEqual([existing]) }
  })

  it('passes a custom scheme through without an existence check', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: any, cb: Function) => cb(null, '', ''))
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: 'obsidian://open?file=x' }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    const [, args] = mockExecFile.mock.calls[0]
    expect(args).toContain('obsidian://open?file=x')
  })

  it('rejects a missing target with 400', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('rejects a foreign origin with 403', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ target: process.cwd() }),
    })
    expect(r.status).toBe(403)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent file target', async () => {
    const port = await listen()
    const r = await fetch(`http://localhost:${port}/api/open-local`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ target: '/no/such/path/xyz-123.md' }),
    })
    expect(r.status).toBe(404)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t "open-local API"`
Expected: FAIL — route returns 404 (Express default, no handler) so the first assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `src/server/api.ts`:

1. Add `existsSync` to the existing `node:fs` import (currently `import { readFileSync, statSync } from 'node:fs'`):

```typescript
import { readFileSync, statSync, existsSync } from 'node:fs'
```

2. Add an import for the helpers (near the other local imports):

```typescript
import { resolveOpenTarget, openCommand, isAllowedOrigin } from './open-local'
```

3. Add the route (place it right after the `/pick-folder` route block):

```typescript
// Open a local-file hyperlink (file:// / absolute path / ~ / custom scheme) clicked in rendered
// markdown. Browsers block file:// navigation from an http page, so the click is routed here and
// the host (this server runs on the user's machine) opens it with the OS default app. Loopback +
// Origin check + JSON-only (CORS preflight) keep other local pages from abusing this.
api.post('/open-local', (req, res) => {
  if (!isAllowedOrigin(req.get('origin') ?? undefined))
    return res.status(403).json({ ok: false, error: 'forbidden origin' })
  const target = req.body?.target
  if (typeof target !== 'string' || target.trim() === '')
    return res.status(400).json({ ok: false, error: 'target required' })
  let resolved
  try { resolved = resolveOpenTarget(target) }
  catch { return res.status(400).json({ ok: false, error: 'unsupported target' }) }
  if (resolved.kind === 'file' && !existsSync(resolved.value))
    return res.status(404).json({ ok: false, error: 'file not found' })
  const { bin, args } = openCommand(process.platform, resolved.value)
  execFile(bin, args, { timeout: 10000 }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: String((err as any)?.message ?? err) })
    res.json({ ok: true })
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/api.test.ts -t "open-local API"`
Expected: PASS (5 cases).

- [ ] **Step 5: Full backend suite + typecheck + commit**

Run: `npx vitest run test/api.test.ts test/open-local.test.ts`
Expected: PASS.

```bash
npx tsc --noEmit
git add src/server/api.ts test/api.test.ts
git commit -m "feat(server): POST /api/open-local opens local-file links on the host"
```

---

### Task 3: Frontend `isLocalHref` (`web/src/lib/local-links.ts`)

**Files:**
- Create: `web/src/lib/local-links.ts`
- Test: `web/src/lib/local-links.test.ts`

(Commands in this task run from the `web/` directory.)

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/local-links.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isLocalHref } from './local-links'

describe('isLocalHref', () => {
  it('treats file://, absolute, ~ and custom-scheme links as local', () => {
    expect(isLocalHref('file:///Users/me/x.md')).toBe(true)
    expect(isLocalHref('/Users/me/x.md')).toBe(true)
    expect(isLocalHref('~/notes/x.md')).toBe(true)
    expect(isLocalHref('obsidian://open?file=x')).toBe(true)
    expect(isLocalHref('vscode://file/Users/me/x')).toBe(true)
  })
  it('treats http(s), mailto, tel, anchors and protocol-relative as non-local', () => {
    expect(isLocalHref('https://example.com')).toBe(false)
    expect(isLocalHref('http://127.0.0.1:7777/app/')).toBe(false)
    expect(isLocalHref('mailto:a@b.com')).toBe(false)
    expect(isLocalHref('tel:+123')).toBe(false)
    expect(isLocalHref('#section')).toBe(false)
    expect(isLocalHref('//cdn.example.com/x')).toBe(false)
    expect(isLocalHref('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx vitest run src/lib/local-links.test.ts`
Expected: FAIL — `Cannot find module './local-links'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/local-links.ts`:

```typescript
/**
 * True when a raw markdown href points at a LOCAL file address that the browser cannot navigate to
 * and Berth must open via the host (file://, an absolute or ~ path, or a custom scheme such as
 * obsidian:// / vscode://). http(s), mailto, tel, in-page anchors and protocol-relative URLs are
 * left to default browser behavior. Read the link's getAttribute('href') (the RAW value) — never
 * `.href`, which the browser would resolve "/Users/…" into a same-origin URL.
 */
export function isLocalHref(href: string): boolean {
  const h = href.trim()
  if (h === '') return false
  if (h.startsWith('#')) return false
  if (/^https?:\/\//i.test(h)) return false
  if (/^(mailto|tel):/i.test(h)) return false
  if (h.startsWith('file://')) return true
  if (h === '~' || h.startsWith('~/')) return true
  if (h.startsWith('/') && !h.startsWith('//')) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(h)) return true // custom scheme://
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx vitest run src/lib/local-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/local-links.ts web/src/lib/local-links.test.ts
git commit -m "feat(web): isLocalHref classifier for local-file markdown links"
```

---

### Task 4: Wire `handleMarkdownClick` + `api.openLocal` into the Markdown component

**Files:**
- Modify: `web/src/lib/api.ts` (add `openLocal` method to the `api` object)
- Modify: `web/src/components/Markdown.tsx` (export `handleMarkdownClick`, add container `onClick`)
- Test: `web/src/components/Markdown.test.ts` (add `handleMarkdownClick` cases)

(Commands run from the `web/` directory.)

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/Markdown.test.ts` (it currently imports only `mdToSafeHtml`; update the import line and add the block):

```typescript
import { mdToSafeHtml, handleMarkdownClick } from './Markdown'
import { vi } from 'vitest'

describe('handleMarkdownClick', () => {
  function clickOn(href: string) {
    const div = document.createElement('div')
    const a = document.createElement('a')
    a.setAttribute('href', href)
    a.textContent = 'link'
    div.appendChild(a)
    const preventDefault = vi.fn()
    const openLocal = vi.fn()
    handleMarkdownClick({ target: a, preventDefault }, openLocal)
    return { preventDefault, openLocal }
  }

  it('intercepts a local link: preventDefault + openLocal(rawHref)', () => {
    const { preventDefault, openLocal } = clickOn('/Users/me/x.md')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openLocal).toHaveBeenCalledWith('/Users/me/x.md')
  })

  it('passes the file:// href through verbatim', () => {
    const { openLocal } = clickOn('file:///Users/me/a%20b.md')
    expect(openLocal).toHaveBeenCalledWith('file:///Users/me/a%20b.md')
  })

  it('ignores an http link (no preventDefault, no openLocal)', () => {
    const { preventDefault, openLocal } = clickOn('https://example.com')
    expect(preventDefault).not.toHaveBeenCalled()
    expect(openLocal).not.toHaveBeenCalled()
  })

  it('does nothing when the click is not on a link', () => {
    const span = document.createElement('span')
    const preventDefault = vi.fn(); const openLocal = vi.fn()
    handleMarkdownClick({ target: span, preventDefault }, openLocal)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(openLocal).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `npx vitest run src/components/Markdown.test.ts -t handleMarkdownClick`
Expected: FAIL — `handleMarkdownClick` is not exported.

- [ ] **Step 3: Write minimal implementation**

3a. In `web/src/lib/api.ts`, add to the `api` object (next to `pickFolder`):

```typescript
  // Ask the host (this Berth server, on the user's machine) to open a local-file link with the OS
  // default app — browsers block file:// / absolute-path navigation from an http page.
  openLocal: (target: string) => send('POST', '/api/open-local', { target }) as Promise<{ ok: boolean; error?: string }>,
```

3b. Rewrite `web/src/components/Markdown.tsx`:

```tsx
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isLocalHref } from '../lib/local-links'
import { api } from '../lib/api'

// Render agent chat text as markdown. Agent output is markdown-heavy (code fences, bold, headings,
// lists), so the chat (Model B) view parses it. Safety: marked → DOMPurify sanitize before injecting,
// so any HTML/script the model emits can't execute. GitHub-flavored line breaks (single \n → <br>).
marked.setOptions({ gfm: true, breaks: true })

/** Parse markdown → sanitized HTML string. Pure + testable; any script/event-handler HTML is stripped. */
export function mdToSafeHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}

/**
 * Click delegation for rendered markdown: if the click lands on an <a> whose RAW href is a local-file
 * address, swallow the (doomed) navigation and ask the host to open it instead. Pure w.r.t. React so
 * it's unit-testable with a plain {target, preventDefault} stub.
 */
export function handleMarkdownClick(
  e: { target: EventTarget | null; preventDefault: () => void },
  openLocal: (href: string) => void,
): void {
  const el = e.target as HTMLElement | null
  const a = el?.closest?.('a') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (!isLocalHref(href)) return
  e.preventDefault()
  openLocal(href)
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => mdToSafeHtml(text), [text])
  return (
    <div
      className={`berth-md ${className}`}
      onClick={(e) => handleMarkdownClick(e, (href) => { api.openLocal(href).catch((err) => console.warn('open-local failed', err)) })}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `web/`): `npx vitest run src/components/Markdown.test.ts`
Expected: PASS (existing `mdToSafeHtml` cases + new `handleMarkdownClick` cases).

- [ ] **Step 5: Typecheck + commit**

Run (from `web/`): `npx tsc --noEmit`
Expected: clean.

```bash
git add web/src/lib/api.ts web/src/components/Markdown.tsx web/src/components/Markdown.test.ts
git commit -m "feat(web): intercept local-file markdown link clicks → open on host"
```

---

### Task 5: Full verification

- [ ] **Step 1: Backend suite green**

Run (repo root): `npm test`
Expected: PASS (includes `test/open-local.test.ts` + `test/api.test.ts`).

- [ ] **Step 2: Web suite green**

Run (from `web/`): `npm test`
Expected: PASS.

- [ ] **Step 3: Typecheck both**

Run: `npx tsc --noEmit` (root) and `cd web && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 4: Manual smoke (macOS, browser mode)**

```bash
berth start    # then open http://127.0.0.1:7777/app/
```
In a chat/task-doc view containing a markdown link to a real local file (e.g. `[doc](file:///Users/<you>/Documents/...)` or `[doc](/Users/<you>/...)`), click it → the file opens in its default app. Click an `obsidian://` link → Obsidian opens. Click a normal `https://` link → still opens in a new browser tab. A non-existent path → no app launches (server replied 404; check console).

- [ ] **Step 5: Log progress on the Berth task**

```bash
berth task log d457c986 "实现完成:POST /api/open-local + 前端 isLocalHref/handleMarkdownClick 拦截;file://、绝对路径、~、obsidian:// 均可经宿主机 open 打开;http(s) 保持原行为。后端+前端单测全绿。"
```
