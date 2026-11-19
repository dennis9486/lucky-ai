import type { FormatFileRequest, FormatFileResult } from '../../shared/types/ipc.js'
import { extname } from 'node:path'
import { createRequire } from 'node:module'
import { createLogger } from '../../shared/utils/log.js'

const PRETTIER_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.jsonc',
  '.vue', '.css', '.scss', '.less',
  '.html', '.htm', '.md', '.mdx',
  '.yaml', '.yml', '.graphql', '.gql'
])

const ESLINT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'
])
const require = createRequire(import.meta.url)

export class FormatterService {
  private readonly logger = createLogger('main/formatter')

  async formatFile(request: FormatFileRequest): Promise<FormatFileResult> {
    const { path, content, workspaceRoot, preferredFormatter = 'auto' } = request
    const ext = extname(path).toLowerCase()
    const candidates = resolveFormatterOrder(preferredFormatter, ext)
    const errors: string[] = []

    for (const candidate of candidates) {
      try {
        if (candidate === 'prettier') {
          const formatted = await tryPrettier(path, content)
          if (formatted !== null && formatted !== content) return { content: formatted, formatter: 'prettier' }
          if (formatted !== null) return { content, formatter: 'prettier' }
        } else if (candidate === 'eslint') {
          const formatted = await tryEslintFix(path, content, workspaceRoot)
          if (formatted !== null && formatted !== content) return { content: formatted, formatter: 'eslint' }
          if (formatted !== null) return { content, formatter: 'eslint' }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${candidate}: ${message}`)
        this.logger.warn('formatter failed', { formatter: candidate, path, error })
      }
    }

    return { content, formatter: 'none', error: errors.join(' | ') || undefined }
  }
}

async function tryPrettier(filePath: string, content: string): Promise<string | null> {
  if (!PRETTIER_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
  const prettier = loadPrettier()
  const config = await prettier.resolveConfig(filePath, {
    editorconfig: true,
    useCache: true
  }).catch(() => null)
  return prettier.format(content, {
    ...(config ?? {}),
    filepath: filePath
  })
}

async function tryEslintFix(filePath: string, content: string, cwd: string): Promise<string | null> {
  if (!ESLINT_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
  const { ESLint } = loadEslint()
  const eslint = new ESLint({
    cwd,
    fix: true
  })
  const [result] = await eslint.lintText(content, { filePath })
  return result?.output ?? null
}

function resolveFormatterOrder(
  preferredFormatter: FormatFileRequest['preferredFormatter'] | undefined,
  ext: string
): Array<'prettier' | 'eslint'> {
  if (preferredFormatter === 'prettier') return PRETTIER_EXTENSIONS.has(ext) ? ['prettier'] : []
  if (preferredFormatter === 'eslint') return ESLINT_EXTENSIONS.has(ext) ? ['eslint'] : []
  if (preferredFormatter === 'lsp') return []

  const order: Array<'prettier' | 'eslint'> = []
  if (PRETTIER_EXTENSIONS.has(ext)) order.push('prettier')
  if (ESLINT_EXTENSIONS.has(ext)) order.push('eslint')
  return order
}

function loadPrettier(): typeof import('prettier') {
  return require('prettier') as typeof import('prettier')
}

function loadEslint(): typeof import('eslint') {
  return require('eslint') as typeof import('eslint')
}

export const formatterService = new FormatterService()
