import { describe, expect, it } from 'vitest'
import { editorContentEquals, normalizeEditorContent } from './editor-content.js'

describe('editorContentEquals', () => {
  it('treats CRLF and LF as equal', () => {
    expect(editorContentEquals('a\r\nb', 'a\nb')).toBe(true)
  })

  it('detects real edits', () => {
    expect(editorContentEquals('hello', 'hello world')).toBe(false)
  })
})

describe('normalizeEditorContent', () => {
  it('normalizes lone CR', () => {
    expect(normalizeEditorContent('a\rb')).toBe('a\nb')
  })
})
