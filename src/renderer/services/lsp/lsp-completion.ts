import type * as Monaco from 'monaco-editor'

type LspRecord = Record<string, unknown>

export function extractCompletionLabel(
  raw: unknown
): string | Monaco.languages.CompletionItemLabel | null {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const record = raw as LspRecord
    if (typeof record.label === 'string') {
      return {
        label: record.label,
        detail: typeof record.detail === 'string' ? record.detail : undefined
      }
    }
  }
  return null
}

export function resolveCompletionInsertText(
  record: LspRecord,
  label: string | Monaco.languages.CompletionItemLabel
): string {
  const textEdit = record.textEdit && typeof record.textEdit === 'object'
    ? record.textEdit as LspRecord
    : null
  if (typeof textEdit?.newText === 'string') return textEdit.newText
  if (typeof record.insertText === 'string') return record.insertText
  return typeof label === 'string' ? label : label.label
}

export function resolveCompletionRange(
  record: LspRecord,
  toMonacoRange: (range: LspRecord) => Monaco.IRange | null,
  fallback: Monaco.IRange
): Monaco.IRange | Monaco.languages.CompletionItemRanges {
  const textEdit = record.textEdit && typeof record.textEdit === 'object'
    ? record.textEdit as LspRecord
    : null
  if (!textEdit) return fallback

  if (textEdit.insert && textEdit.replace && typeof textEdit.insert === 'object' && typeof textEdit.replace === 'object') {
    const insert = toMonacoRange(textEdit.insert as LspRecord)
    const replace = toMonacoRange(textEdit.replace as LspRecord)
    if (insert && replace) return { insert, replace }
  }

  if (textEdit.range && typeof textEdit.range === 'object') {
    return toMonacoRange(textEdit.range as LspRecord) ?? fallback
  }

  return fallback
}
