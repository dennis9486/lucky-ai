import { describe, expect, it } from 'vitest'
import { buildTextPdf, buildPdfHtml } from './pdf.service.js'

describe('buildPdfHtml (rich rendering)', () => {
  it('renders markdown headings, tables and line breaks', () => {
    const html = buildPdfHtml('Report', '# Section\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nline1\nline2', 'markdown')
    expect(html).toContain('class="pdf-title"')
    expect(html).toContain('Report')
    expect(html).toContain('<h1')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<br') // breaks: true keeps single newlines
    expect(html).toContain('Content-Security-Policy')
  })

  it('allows inline HTML colors and inline SVG charts', () => {
    const html = buildPdfHtml(undefined, '<span style="color:#c00">red</span><svg><rect width="10" height="10"/></svg>', 'html')
    expect(html).toContain('color:#c00')
    expect(html).toContain('<svg>')
  })

  it('strips scripts and inline event handlers (defense in depth)', () => {
    const html = buildPdfHtml(undefined, '<p onclick="steal()">x</p><script>alert(1)</script>', 'html')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('onclick')
  })

  it('escapes text format verbatim', () => {
    const html = buildPdfHtml(undefined, '<b> & </b>', 'text')
    expect(html).toContain('<pre>')
    expect(html).toContain('&lt;b&gt; &amp; &lt;/b&gt;')
  })
})

describe('buildTextPdf', () => {
  it('produces a structurally valid single-page PDF', () => {
    const { bytes, pages, replacedNonLatin } = buildTextPdf({ title: 'Report', content: 'Hello world.\nSecond line.' })
    const text = bytes.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).toContain('xref')
    expect(text).toContain('startxref')
    expect(text).toContain('/Root 1 0 R')
    expect(pages).toBe(1)
    expect(replacedNonLatin).toBe(false)
  })

  it('escapes PDF-special characters', () => {
    const text = buildTextPdf({ content: 'a (b) \\ c' }).bytes.toString('latin1')
    expect(text).toContain('(a \\(b\\) \\\\ c)')
  })

  it('paginates long content into multiple pages', () => {
    const content = Array.from({ length: 200 }, (_, i) => `Line number ${i}`).join('\n')
    const result = buildTextPdf({ content })
    expect(result.pages).toBeGreaterThan(1)
    // /Count must match the number of page objects
    expect(result.bytes.toString('latin1')).toContain(`/Count ${result.pages}`)
  })

  it('flags non-Latin characters as replaced', () => {
    const result = buildTextPdf({ content: '中文内容 🚀' })
    expect(result.replacedNonLatin).toBe(true)
    expect(result.bytes.toString('latin1')).not.toContain('中')
  })

  it('handles empty content without crashing', () => {
    const result = buildTextPdf({ content: '' })
    expect(result.pages).toBe(1)
    // 括号在 PDF 里被转义为 \( \)，故只断言内部文本
    expect(result.bytes.toString('latin1')).toContain('empty document')
  })
})
