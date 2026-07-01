import { describe, it, expect } from 'vitest'
import { mdToSafeHtml, handleMarkdownClick } from './Markdown'
import { vi } from 'vitest'

describe('mdToSafeHtml', () => {
  it('renders common markdown (bold, inline code, headings, lists, fenced code)', () => {
    expect(mdToSafeHtml('**bold**')).toContain('<strong>bold</strong>')
    expect(mdToSafeHtml('`x = 1`')).toContain('<code>x = 1</code>')
    expect(mdToSafeHtml('# Title')).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(mdToSafeHtml('- a\n- b')).toContain('<li>a</li>')
    const fenced = mdToSafeHtml('```\nconst y = 2\n```')
    expect(fenced).toContain('<pre>')
    expect(fenced).toContain('const y = 2')
  })

  it('renders links', () => {
    expect(mdToSafeHtml('[berth](https://example.com)')).toContain('href="https://example.com"')
  })

  it('STRIPS script tags and inline event handlers (XSS safety)', () => {
    const out = mdToSafeHtml('hi <script>alert(1)</script> there')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('alert(1)')
    const img = mdToSafeHtml('<img src=x onerror="alert(1)">')
    expect(img).not.toContain('onerror')
  })

  it('preserves single newlines as <br> (gfm breaks)', () => {
    expect(mdToSafeHtml('line1\nline2')).toContain('<br>')
  })

  // Regression for the C1 integration gap: DOMPurify's DEFAULT URI allowlist strips href for file://
  // and app schemes, which silently killed local links downstream of the click handler. The widened
  // ALLOWED_URI_REGEXP must KEEP these hrefs through the real marked→sanitize pipeline...
  it('preserves href for file:// and allowlisted app schemes (local links stay clickable)', () => {
    expect(mdToSafeHtml('[a](file:///Users/me/x.md)')).toContain('href="file:///Users/me/x.md"')
    expect(mdToSafeHtml('[a](obsidian://open?file=x)')).toContain('href="obsidian://open?file=x"')
    expect(mdToSafeHtml('[a](vscode://file/Users/me/x)')).toContain('href="vscode://file/Users/me/x"')
    expect(mdToSafeHtml('[a](/Users/me/x.md)')).toContain('href="/Users/me/x.md"') // absolute still works
  })

  // ...while NOT re-admitting dangerous schemes the widening could have leaked (incl. the javascript://
  // comment-bypass). These must still be stripped.
  it('still strips javascript:/data: hrefs after widening the allowlist (no XSS)', () => {
    expect(mdToSafeHtml('[a](javascript:alert(1))')).not.toContain('javascript:')
    expect(mdToSafeHtml('[a](javascript://%0aalert(1))')).not.toContain('alert')
    expect(mdToSafeHtml('[a](data:text/html,<script>alert(1)</script>)')).not.toContain('data:text/html')
  })
})

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

  it('intercepts ~/ and custom-scheme local links', () => {
    expect(clickOn('~/notes/x.md').openLocal).toHaveBeenCalledWith('~/notes/x.md')
    expect(clickOn('obsidian://open?file=x').openLocal).toHaveBeenCalledWith('obsidian://open?file=x')
  })

  it('resolves the enclosing <a> when the click lands on a nested element', () => {
    // The whole point of closest('a'): a click on <code> inside the link still intercepts.
    const div = document.createElement('div')
    const a = document.createElement('a')
    a.setAttribute('href', '/Users/me/x.md')
    const code = document.createElement('code')
    code.textContent = 'x.md'
    a.appendChild(code)
    div.appendChild(a)
    const preventDefault = vi.fn(); const openLocal = vi.fn()
    handleMarkdownClick({ target: code, preventDefault }, openLocal)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openLocal).toHaveBeenCalledWith('/Users/me/x.md')
  })
})
