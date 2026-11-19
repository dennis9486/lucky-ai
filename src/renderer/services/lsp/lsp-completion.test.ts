import { describe, expect, it } from 'vitest'
import {
  extractCompletionLabel,
  resolveCompletionInsertText,
  resolveCompletionRange
} from './lsp-completion.js'

describe('extractCompletionLabel', () => {
  it('accepts string labels', () => {
    expect(extractCompletionLabel('foo')).toBe('foo')
  })

  it('accepts structured labels', () => {
    expect(extractCompletionLabel({ label: 'foo', detail: 'bar' })).toEqual({
      label: 'foo',
      detail: 'bar'
    })
  })

  it('rejects invalid labels', () => {
    expect(extractCompletionLabel(null)).toBeNull()
    expect(extractCompletionLabel({ kind: 1 })).toBeNull()
  })
})

describe('resolveCompletionInsertText', () => {
  it('prefers textEdit.newText', () => {
    expect(resolveCompletionInsertText(
      { textEdit: { newText: 'inserted' } },
      'label'
    )).toBe('inserted')
  })

  it('falls back to label text', () => {
    expect(resolveCompletionInsertText({}, 'fallback')).toBe('fallback')
  })
})

describe('resolveCompletionRange', () => {
  const toRange = (range: Record<string, unknown>) => ({
    startLineNumber: (range.start as { line: number }).line + 1,
    startColumn: (range.start as { character: number }).character + 1,
    endLineNumber: (range.end as { line: number }).line + 1,
    endColumn: (range.end as { character: number }).character + 1
  })

  it('maps insert/replace edits', () => {
    const result = resolveCompletionRange({
      textEdit: {
        newText: 'x',
        insert: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        replace: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      }
    }, toRange, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })

    expect(result).toEqual({
      insert: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      replace: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }
    })
  })
})
