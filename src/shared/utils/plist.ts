/**
 * Minimal XML plist parser for TextMate grammar files (.tmLanguage, .plist).
 * Supports dict, array, string, integer, real, true, false, data.
 */
export function parsePlistXml(content: string): unknown {
  const tokens = tokenizePlistXml(content)
  let cursor = 0
  while (cursor < tokens.length && tokens[cursor]?.type === 'text') cursor += 1
  const [value, nextIndex] = parseValue(tokens, cursor)
  let trailing = nextIndex
  while (trailing < tokens.length && tokens[trailing]?.type === 'close') trailing += 1
  if (trailing < tokens.length) {
    throw new Error('Unexpected trailing plist content')
  }
  return value
}

type PlistToken =
  | { type: 'open'; tag: string }
  | { type: 'close'; tag: string }
  | { type: 'text'; value: string }

function tokenizePlistXml(content: string): PlistToken[] {
  const normalized = content
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
  const tokens: PlistToken[] = []
  const pattern = /<!--[\s\S]*?-->|<\/?([A-Za-z0-9_:-]+)([^>]*)>|([^<]+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalized)) !== null) {
    const [, tagName, , text] = match
    if (tagName) {
      const tag = tagName.toLowerCase()
      if (match[0].startsWith('</')) tokens.push({ type: 'close', tag })
      else tokens.push({ type: 'open', tag })
      continue
    }
    const trimmed = text?.trim()
    if (trimmed) tokens.push({ type: 'text', value: decodeXmlEntities(trimmed) })
  }

  return tokens
}

function parseValue(tokens: PlistToken[], index: number): [unknown, number] {
  while (index < tokens.length && tokens[index]?.type === 'text') index += 1
  const token = tokens[index]
  if (!token || token.type !== 'open') throw new Error('Invalid plist structure')

  switch (token.tag) {
    case 'dict':
      return parseDict(tokens, index + 1)
    case 'array':
      return parseArray(tokens, index + 1)
    case 'string':
      return parsePrimitive(tokens, index + 1, 'string')
    case 'integer':
      return parsePrimitive(tokens, index + 1, 'integer')
    case 'real':
      return parsePrimitive(tokens, index + 1, 'real')
    case 'data':
      return parsePrimitive(tokens, index + 1, 'data')
    case 'true':
      return consumeSelfClosing(tokens, index, 'true', true)
    case 'false':
      return consumeSelfClosing(tokens, index, 'false', false)
    case 'plist': {
      const [value, nextIndex] = parseValue(tokens, index + 1)
      const closing = tokens[nextIndex]
      if (closing?.type === 'close' && closing.tag === 'plist') {
        return [value, nextIndex + 1]
      }
      return [value, nextIndex]
    }
    default:
      throw new Error(`Unsupported plist tag: ${token.tag}`)
  }
}

function parseDict(tokens: PlistToken[], index: number): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {}
  let cursor = index

  while (cursor < tokens.length) {
    const token = tokens[cursor]
    if (token?.type === 'close' && token.tag === 'dict') return [result, cursor + 1]
    if (token?.type !== 'open' || token.tag !== 'key') throw new Error('Expected plist key')
    const keyToken = tokens[cursor + 1]
    if (keyToken?.type !== 'text') throw new Error('Expected plist key text')
    const closeKey = tokens[cursor + 2]
    if (closeKey?.type !== 'close' || closeKey.tag !== 'key') throw new Error('Expected closing key')
    const [value, nextIndex] = parseValue(tokens, cursor + 3)
    result[keyToken.value] = value
    cursor = nextIndex
  }

  throw new Error('Unclosed plist dict')
}

function parseArray(tokens: PlistToken[], index: number): [unknown[], number] {
  const result: unknown[] = []
  let cursor = index

  while (cursor < tokens.length) {
    const token = tokens[cursor]
    if (token?.type === 'close' && token.tag === 'array') return [result, cursor + 1]
    const [value, nextIndex] = parseValue(tokens, cursor)
    result.push(value)
    cursor = nextIndex
  }

  throw new Error('Unclosed plist array')
}

function parsePrimitive(
  tokens: PlistToken[],
  index: number,
  tag: 'string' | 'integer' | 'real' | 'data'
): [unknown, number] {
  const textToken = tokens[index]
  const closeToken = tokens[index + 1]
  if (closeToken?.type === 'close' && closeToken.tag === tag) {
    const raw = textToken?.type === 'text' ? textToken.value : ''
    if (tag === 'integer') return [Number.parseInt(raw, 10), index + 2]
    if (tag === 'real') return [Number.parseFloat(raw), index + 2]
    return [raw, index + 2]
  }
  throw new Error(`Expected closing ${tag}`)
}

function consumeSelfClosing(
  tokens: PlistToken[],
  index: number,
  tag: string,
  value: boolean
): [boolean, number] {
  const next = tokens[index + 1]
  if (next?.type === 'close' && next.tag === tag) return [value, index + 2]
  return [value, index + 1]
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

export function isPlistGrammarPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.plist') || lower.endsWith('.tmlanguage') || lower.includes('.tmlanguage.')
}
