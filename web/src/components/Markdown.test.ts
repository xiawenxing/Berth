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
})
