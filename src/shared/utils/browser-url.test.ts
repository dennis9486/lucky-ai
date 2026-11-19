import { describe, expect, it } from 'vitest'
import { normalizeBrowserHomepage } from './browser-url.js'

describe('normalizeBrowserHomepage', () => {
  it('keeps blank homepage as blank tab', () => {
    expect(normalizeBrowserHomepage('   ', 'https://example.com')).toBe('')
  })

  it('accepts explicit http and https URLs', () => {
    expect(normalizeBrowserHomepage('https://www.bing.com')).toBe('https://www.bing.com')
    expect(normalizeBrowserHomepage('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('adds https for host-like input', () => {
    expect(normalizeBrowserHomepage('bing.com/search')).toBe('https://bing.com/search')
  })

  it('falls back for unsafe or invalid input', () => {
    expect(normalizeBrowserHomepage('javascript:alert(1)', 'https://safe.test')).toBe('https://safe.test')
    expect(normalizeBrowserHomepage('not a url', 'https://safe.test')).toBe('https://safe.test')
  })
})

