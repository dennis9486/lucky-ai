import type { Terminal } from 'xterm'

const PROMPT_PATTERN = /(?:^|\s)(?:[\w.@~-]+)?[$%#](?:\s|$)|^>\s?$/

export function isPromptLine(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!trimmed || trimmed.length > 160) return false
  if (PROMPT_PATTERN.test(trimmed)) return true
  return /[%$#]\s?$/.test(trimmed)
}

export function scrollToPreviousCommand(term: Terminal): boolean {
  const buffer = term.buffer.active
  const cursorLine = buffer.baseY + buffer.cursorY
  let target: number | null = null

  for (let line = cursorLine - 1; line >= 0; line -= 1) {
    const row = buffer.getLine(line)
    if (!row) continue
    if (isPromptLine(row.translateToString(true))) {
      target = line
      break
    }
  }

  if (target === null) return false
  term.scrollToLine(Math.max(0, target))
  return true
}

export function scrollToNextCommand(term: Terminal): boolean {
  const buffer = term.buffer.active
  const viewportBottom = buffer.baseY + buffer.viewportY + term.rows - 1
  const maxLine = buffer.length - 1
  let target: number | null = null

  for (let line = viewportBottom + 1; line <= maxLine; line += 1) {
    const row = buffer.getLine(line)
    if (!row) continue
    if (isPromptLine(row.translateToString(true))) {
      target = line
      break
    }
  }

  if (target === null) return false
  term.scrollToLine(Math.max(0, target))
  return true
}

export function buildRunCommand(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const quoted = quoteShellPath(filePath)

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return `node ${quoted}`
    case 'ts':
    case 'tsx':
      return `pnpm exec tsx ${quoted}`
    case 'jsx':
      return `pnpm exec tsx ${quoted}`
    case 'py':
      return `python3 ${quoted}`
    case 'sh':
    case 'bash':
      return `bash ${quoted}`
    case 'go':
      return `go run ${quoted}`
    case 'rs':
      return `cargo run --manifest-path ${quoted}`
    default:
      return null
  }
}

export function quoteShellPath(path: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\\''`)}'`
}

export function normalizeCommandInput(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function extractCdTarget(command: string): string | null {
  const match = command.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}
