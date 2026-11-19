const IME_ASCII_APOSTROPHE_WORD = /\b(?:[A-Za-z]['’]){2,}[A-Za-z]+(?:['’][A-Za-z]+)*\b/g

export function normalizeGeneratedTitleText(text: string): string {
  return text
    .replace(IME_ASCII_APOSTROPHE_WORD, (value) => value.replace(/['’]/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactGeneratedTitle(text: string, fallback: string, maxLength: number): string {
  const compact = normalizeGeneratedTitleText(text)
  if (!compact) return fallback
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact
}
