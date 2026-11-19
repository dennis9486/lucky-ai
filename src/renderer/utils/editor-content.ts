/** Normalize line endings so disk vs Monaco model comparisons stay stable. */
export function normalizeEditorContent(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function editorContentEquals(a: string, b: string): boolean {
  return normalizeEditorContent(a) === normalizeEditorContent(b)
}
