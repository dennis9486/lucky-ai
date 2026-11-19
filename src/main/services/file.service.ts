import { readdir, readFile, writeFile, mkdir, rm, rename, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join, relative, extname } from 'node:path'
import type {
  FileContentMatch,
  FileContentReplaceOptions,
  FileContentReplaceResult,
  FileContentSearchOptions,
  FileContentSearchResult,
  FileTreeNode,
  FileSearchResult
} from '../../shared/types/workspace.js'
import type { FileReadResult } from '../../shared/types/ipc.js'
import { securityService } from './security.service.js'

const MAX_FILE_SIZE = 512 * 1024 // 512KB 完整读取上限
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const MAX_MATCHES_PER_FILE = 20
const DEFAULT_MAX_SEARCH_RESULTS = 1000
const SUMMARY_LINES = 50

/** 搜索/遍历文件时跳过，避免扫描超大目录 */
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules', '.pnpm'])
/** 资源管理器可见，但默认不预加载子节点 */
const LAZY_TREE_DIRS = new Set(['node_modules', '.pnpm'])
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.avif',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.dmg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wasm',
  '.class', '.jar', '.exe', '.dll', '.so', '.dylib'
])

export class FileService {
  /** 读取文件，大文件返回摘要 */
  async readFile(relativePath: string): Promise<FileReadResult> {
    const absPath = securityService.resolveSafePath(relativePath)
    const fileStat = await stat(absPath)

    if (!fileStat.isFile()) {
      throw new Error('不是文件')
    }

    if (fileStat.size > MAX_FILE_SIZE) {
      const content = await readFile(absPath, 'utf-8')
      const lines = content.split('\n')
      const summary = lines.slice(0, SUMMARY_LINES).join('\n')
      return {
        path: relativePath,
        content: summary,
        truncated: true,
        summary: `[文件过大 ${fileStat.size} bytes，仅返回前 ${SUMMARY_LINES} 行摘要]`
      }
    }

    const content = await readFile(absPath, 'utf-8')
    return { path: relativePath, content, truncated: false }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const absPath = securityService.resolveSafePath(relativePath)
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, content, 'utf-8')
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absPath = securityService.resolveSafePath(relativePath)
    await rm(absPath, { recursive: true, force: false })
  }

  async createFile(relativePath: string, content = ''): Promise<void> {
    await this.writeFile(relativePath, content)
  }

  async renameFile(fromPath: string, toPath: string): Promise<void> {
    const fromAbsPath = securityService.resolveSafePath(fromPath)
    const toAbsPath = securityService.resolveSafePath(toPath)
    await mkdir(dirname(toAbsPath), { recursive: true })
    await rename(fromAbsPath, toAbsPath)
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const absPath = securityService.resolveSafePath(relativePath)
      await stat(absPath)
      return true
    } catch {
      return false
    }
  }

  /** 编辑文件 — 替换 oldText 为 newText */
  async editFile(relativePath: string, oldText: string, newText: string): Promise<void> {
    const { content } = await this.readFile(relativePath)
    if (!content.includes(oldText)) {
      throw new Error('未找到要替换的文本')
    }
    await this.writeFile(relativePath, content.replace(oldText, newText))
  }

  /** 构建目录树 */
  async buildTree(relativePath = '.'): Promise<FileTreeNode[]> {
    const root = securityService.getWorkspaceRoot()
    if (!root) return []

    const absPath = securityService.resolveSafePath(relativePath)
    const entries = await readdir(absPath, { withFileTypes: true })
    entries.sort(compareFileTreeEntries)

    const nodes: FileTreeNode[] = []
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === '.git') continue

      const relPath = relative(root, join(absPath, entry.name))
      if (entry.isDirectory()) {
        if (LAZY_TREE_DIRS.has(entry.name)) {
          nodes.push({ name: entry.name, path: relPath, type: 'directory', children: [], lazy: true })
          continue
        }
        const children = await this.buildTree(relPath)
        nodes.push({ name: entry.name, path: relPath, type: 'directory', children })
      } else {
        nodes.push({ name: entry.name, path: relPath, type: 'file' })
      }
    }
    return nodes
  }

  /** 搜索文件名 */
  async searchFiles(query: string, basePath = '.'): Promise<FileSearchResult[]> {
    const results: FileSearchResult[] = []
    const lowerQuery = query.toLowerCase()

    const walk = async (relPath: string): Promise<void> => {
      const absPath = securityService.resolveSafePath(relPath)
      const entries = await readdir(absPath, { withFileTypes: true })

      for (const entry of entries) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue
        const childRel = relPath === '.' ? entry.name : `${relPath}/${entry.name}`

        if (entry.isDirectory()) {
          if (entry.name.toLowerCase().includes(lowerQuery)) {
            results.push({ path: childRel, name: entry.name, type: 'directory' })
          }
          await walk(childRel)
        } else if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push({ path: childRel, name: entry.name, type: 'file' })
        }

        if (results.length >= 100) return
      }
    }

    await walk(basePath)
    return results
  }

  /** 搜索工作区文件内容 */
  async searchContent(options: FileContentSearchOptions): Promise<FileContentSearchResult[]> {
    const query = options.query.trim()
    if (!query) return []

    const matcher = createSearchRegExp(options)
    const includePatterns = parseGlobList(options.includes)
    const excludePatterns = parseGlobList(options.excludes)
    const maxResults = Math.min(Math.max(options.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS, 1), 5000)
    const files = await this.listFiles('.', true)
    const results: FileContentSearchResult[] = []
    let totalMatches = 0

    for (const path of files) {
      if (totalMatches >= maxResults) break
      if (!shouldSearchPath(path, includePatterns, excludePatterns)) continue

      const absPath = securityService.resolveSafePath(path)
      const fileStat = await stat(absPath)
      if (!fileStat.isFile() || fileStat.size > MAX_SEARCH_FILE_SIZE || isLikelyBinaryPath(path)) continue

      const content = await readTextIfSearchable(absPath)
      if (content === null) continue

      const matches = collectLineMatches(content, matcher, maxResults - totalMatches)
      if (!matches.length) continue

      totalMatches += matches.length
      results.push({
        path,
        name: path.split('/').pop() ?? path,
        matches
      })
    }

    return results
  }

  /** 替换工作区文件内容 */
  async replaceContent(options: FileContentReplaceOptions): Promise<FileContentReplaceResult> {
    const query = options.query.trim()
    if (!query) return { filesChanged: 0, matchesReplaced: 0 }

    const matcher = createSearchRegExp(options)
    const includePatterns = parseGlobList(options.includes)
    const excludePatterns = parseGlobList(options.excludes)
    const fileSet = options.paths?.length ? new Set(options.paths) : null
    const files = fileSet ? [...fileSet] : await this.listFiles('.', true)
    let filesChanged = 0
    let matchesReplaced = 0

    for (const path of files) {
      if (!shouldSearchPath(path, includePatterns, excludePatterns)) continue
      if (isLikelyBinaryPath(path)) continue

      const absPath = securityService.resolveSafePath(path)
      const fileStat = await stat(absPath)
      if (!fileStat.isFile() || fileStat.size > MAX_SEARCH_FILE_SIZE) continue

      const content = await readTextIfSearchable(absPath)
      if (content === null) continue

      const perFileMatcher = cloneRegExp(matcher)
      const matchCount = countMatches(content, perFileMatcher)
      if (!matchCount) continue

      const nextContent = content.replace(cloneRegExp(matcher), options.replacement)
      await writeFile(absPath, nextContent, 'utf-8')
      filesChanged += 1
      matchesReplaced += matchCount
    }

    return { filesChanged, matchesReplaced }
  }

  /** 递归列出文件 */
  async listFiles(relativePath = '.', recursive = false): Promise<string[]> {
    const files: string[] = []
    const walk = async (relPath: string): Promise<void> => {
      const absPath = securityService.resolveSafePath(relPath)
      const entries = await readdir(absPath, { withFileTypes: true })
      for (const entry of entries) {
        if (WALK_SKIP_DIRS.has(entry.name)) continue
        const childRel = relPath === '.' ? entry.name : `${relPath}/${entry.name}`
        if (entry.isDirectory()) {
          if (recursive) await walk(childRel)
        } else {
          files.push(childRel)
        }
      }
    }
    await walk(relativePath)
    return files
  }

  detectLanguage(filePath: string): string {
    const ext = extname(filePath).slice(1)
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      vue: 'html', json: 'json', css: 'css', html: 'html', md: 'markdown',
      py: 'python', rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml'
    }
    return map[ext] ?? 'plaintext'
  }
}

export const fileService = new FileService()

function compareFileTreeEntries(a: Dirent, b: Dirent): number {
  const aIsDir = a.isDirectory()
  const bIsDir = b.isDirectory()
  if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function createSearchRegExp(options: FileContentSearchOptions): RegExp {
  const flags = `gmu${options.caseSensitive ? '' : 'i'}`
  const source = options.regex ? options.query : escapeRegExp(options.query)
  const wholeWordSource = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])`
    : source
  try {
    return new RegExp(wholeWordSource, flags)
  } catch (error) {
    throw new Error(`无效搜索表达式：${error instanceof Error ? error.message : String(error)}`)
  }
}

function collectLineMatches(content: string, matcher: RegExp, remaining: number): FileContentMatch[] {
  const matches: FileContentMatch[] = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= remaining || matches.length >= MAX_MATCHES_PER_FILE) break
    const line = lines[index] ?? ''
    const lineMatcher = cloneRegExp(matcher)
    let match: RegExpExecArray | null
    while ((match = lineMatcher.exec(line)) !== null) {
      const text = match[0]
      const startColumn = match.index + 1
      matches.push({
        lineNumber: index + 1,
        lineText: line,
        preview: trimPreview(line, startColumn),
        startColumn,
        endColumn: startColumn + Math.max(text.length, 1)
      })
      if (matches.length >= remaining || matches.length >= MAX_MATCHES_PER_FILE) break
      if (text.length === 0) lineMatcher.lastIndex += 1
    }
  }
  return matches
}

function countMatches(content: string, matcher: RegExp): number {
  let count = 0
  let match: RegExpExecArray | null
  while ((match = matcher.exec(content)) !== null) {
    count += 1
    if (match[0].length === 0) matcher.lastIndex += 1
  }
  return count
}

async function readTextIfSearchable(absPath: string): Promise<string | null> {
  const content = await readFile(absPath, 'utf-8')
  return content.includes('\u0000') ? null : content
}

function shouldSearchPath(path: string, includes: RegExp[], excludes: RegExp[]): boolean {
  const normalized = normalizePath(path)
  if (includes.length && !includes.some((pattern) => pattern.test(normalized))) return false
  return !excludes.some((pattern) => pattern.test(normalized))
}

function parseGlobList(value?: string): RegExp[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(globToRegExp)
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern)
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += escapeRegExp(char ?? '')
    }
  }

  const anchored = normalized.includes('/')
    ? `^${source}$`
    : `(^|/)${source}$`
  return new RegExp(anchored)
}

function trimPreview(line: string, startColumn: number): string {
  const max = 180
  if (line.length <= max) return line.trim()
  const start = Math.max(startColumn - 60, 0)
  const end = Math.min(start + max, line.length)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < line.length ? '…' : ''
  return `${prefix}${line.slice(start, end)}${suffix}`.trim()
}

function isLikelyBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase())
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cloneRegExp(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags)
}
