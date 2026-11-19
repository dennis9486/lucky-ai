import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPlistGrammarPath, parsePlistXml } from '../../shared/utils/plist.js'

export async function readGrammarFile(absPath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(absPath)) return null

  try {
    const raw = await readFile(absPath, 'utf8')
    if (absPath.endsWith('.json')) {
      return JSON.parse(raw) as Record<string, unknown>
    }
    if (isPlistGrammarPath(absPath)) {
      const parsed = parsePlistXml(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    }
  } catch {
    return null
  }

  return null
}

export async function readThemeFile(absPath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(absPath) || !absPath.endsWith('.json')) return null
  try {
    return JSON.parse(await readFile(absPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isGrammarFile(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.json') || isPlistGrammarPath(lower)
}

export function resolveGrammarPath(extensionPath: string, relativePath: string): string {
  return join(extensionPath, relativePath)
}
