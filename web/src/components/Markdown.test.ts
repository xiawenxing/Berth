import { describe, it, expect } from 'vitest'
import { mdToSafeHtml } from './Markdown'

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
