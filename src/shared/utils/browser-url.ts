const HOST_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i

/**
 * Normalizes user-entered browser home/search URLs without guessing unsafe schemes.
 * Empty means "blank tab"; invalid input falls back to the current persisted value.
 */
export function normalizeBrowserHomepage(raw: string, fallback = ''): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (HOST_LIKE_RE.test(value)) return `https://${value}`
  return fallback
}

