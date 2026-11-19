import { createHash } from 'node:crypto'
import { basename, extname, join, relative, resolve } from 'node:path'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type {
  EditorWorkspaceState,
  WorkspaceGitBranch,
  WorkspaceGitCommitResult,
  WorkspaceGitConflictFile,
  WorkspaceGitFileDiff,
  WorkspaceGitFileHunks,
  WorkspaceGitFileStatus,
  WorkspaceGitGraphLine,
  WorkspaceGitReviewResult,
  WorkspaceGitStashEntry,
  WorkspaceGitStatus,
  WorkspaceGitSyncResult,
  WorkspaceInfo
} from '../../shared/types/workspace.js'
import { DatabaseService } from '../db/database.service.js'
import { securityService } from './security.service.js'
import { fileService } from './file.service.js'
import { aiService } from './ai.service.js'
import {
  buildHunkPatch,
  isGitConflict,
  parseUnifiedDiffHunks,
  suggestCommitMessageFromStatus,
  summarizeGitStatus
} from './git-diff.js'
import { parseGitConflictMarkers } from '../../shared/utils/git-conflict.js'
import { execGit, execGitBuffer, execGitLocked, withRepoLock } from './git-exec.js'
import { gitWatcherService } from './git-watcher.service.js'

const DIFF_MAX_TEXT_BYTES = 1024 * 1024
const EDITOR_STATE_PREF_PREFIX = 'workspace.editorState.'
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.avif',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.dmg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wasm',
  '.class', '.jar', '.exe', '.dll', '.so', '.dylib'
])

export class WorkspaceService {
  private workspace: WorkspaceInfo | null = null

  private get db() {
    return DatabaseService.getInstance().db
  }

  setWorkspace(rootPath: string): WorkspaceInfo {
    securityService.setWorkspaceRoot(rootPath)
    this.workspace = {
      rootPath,
      name: basename(rootPath),
      openedAt: Date.now()
    }
    // 监听 .git 变化：终端/Agent 改动仓库时向 renderer 广播刷新（失败不影响打开工作区）
    void gitWatcherService.watch(rootPath).catch(() => undefined)
    return this.workspace
  }

  getWorkspace(): WorkspaceInfo | null {
    return this.workspace
  }

  async getTree(relativePath = '.') {
    return fileService.buildTree(relativePath)
  }

  getEditorState(rootPath?: string): EditorWorkspaceState | null {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) return null

    const row = this.db
      .prepare('SELECT value FROM app_preferences WHERE key = ?')
      .get(editorStatePrefKey(cwd)) as { value: string } | undefined
    if (!row?.value) return null

    try {
      return sanitizeEditorWorkspaceState(JSON.parse(row.value), cwd)
    } catch {
      return null
    }
  }

  setEditorState(state: EditorWorkspaceState, rootPath?: string): void {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) return

    const sanitized = sanitizeEditorWorkspaceState(state, cwd)
    if (!sanitized) return

    this.db
      .prepare(`
        INSERT INTO app_preferences (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(editorStatePrefKey(cwd), JSON.stringify({ ...sanitized, updatedAt: Date.now() }))
  }

  /** 生成项目结构摘要（供 AI 上下文） */
  async getStructureSummary(maxFiles = 80): Promise<string> {
    const files = await fileService.listFiles('.', true)
    const limited = files.slice(0, maxFiles)
    const lines = limited.map((f) => `- ${f}`)
    if (files.length > maxFiles) {
      lines.push(`... 还有 ${files.length - maxFiles} 个文件`)
    }
    return lines.join('\n')
  }

  async getGitBranch(rootPath?: string): Promise<string | null> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) return null
    try {
      if (!(await isGitRepository(cwd))) return null
      const { stdout } = await execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const branch = stdout.trim()
      if (!branch || branch === 'HEAD') {
        const head = await getGitHead(cwd)
        return head ? `HEAD@${head}` : null
      }
      return branch
    } catch {
      return null
    }
  }

  async getGitStatus(rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) return emptyGitStatus()
    if (!(await isGitRepository(cwd))) return emptyGitStatus()

    try {
      const [{ stdout: branchStdout }, { stdout: statusStdout }, head, upstream] = await Promise.all([
        execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
        // -uall：把未跟踪目录展开为单个文件，暂存/丢弃粒度与 VS Code 对齐
        execGit(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=all', '-z']),
        getGitHead(cwd),
        getGitUpstream(cwd)
      ])
      const rawBranch = branchStdout.trim()
      const detached = rawBranch === 'HEAD'
      const branch = detached ? (head ? `HEAD@${head}` : null) : rawBranch || null
      const { files, ahead, behind } = parseGitStatus(statusStdout)
      return {
        branch,
        dirtyCount: files.length,
        isRepository: true,
        head,
        detached,
        upstream,
        ahead,
        behind,
        files
      }
    } catch {
      const branch = await this.getGitBranch(cwd)
      return { ...emptyGitStatus(), branch, isRepository: true }
    }
  }

  async listGitGraph(rootPath?: string, limit = 35): Promise<WorkspaceGitGraphLine[]> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd || !(await isGitRepository(cwd))) return []
    const maxCount = Math.min(Math.max(limit, 1), 100)
    try {
      const { stdout } = await execGit(cwd, [
        'log',
        `--max-count=${maxCount}`,
        '--graph',
        '--decorate',
        '--oneline',
        '--abbrev-commit',
        '--date-order'
      ])
      return parseGitGraph(stdout)
    } catch {
      return []
    }
  }

  async listGitBranches(rootPath?: string): Promise<WorkspaceGitBranch[]> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) return []
    if (!(await isGitRepository(cwd))) return []

    try {
      const { stdout } = await execGit(
        cwd,
        ['branch', '--all', '--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(objectname:short)']
      )
      const seen = new Set<string>()
      return stdout.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [head = '', rawName = '', upstream = '', lastCommit = ''] = line.split('|')
          const remote = rawName.startsWith('remotes/')
          const name = rawName.replace(/^remotes\/origin\//, '')
          return {
            name,
            current: head === '*',
            remote,
            upstream: upstream || null,
            lastCommit: lastCommit || null
          }
        })
        .filter((branch) => {
          if (!branch.name || branch.name === 'HEAD') return false
          const key = branch.name
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
    } catch {
      return []
    }
  }

  async checkoutGitBranch(branch: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    const cleanBranch = sanitizeBranchName(branch)
    await execGitLocked(cwd, ['switch', cleanBranch])
    return this.getGitStatus(cwd)
  }

  async createGitBranch(branch: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    const cleanBranch = sanitizeBranchName(branch)
    await execGitLocked(cwd, ['switch', '-c', cleanBranch])
    return this.getGitStatus(cwd)
  }

  async getGitFileDiff(path: string, rootPath?: string): Promise<WorkspaceGitFileDiff> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    const file = await getGitFileStatus(cwd, path)
    if (!file) throw new Error('未找到文件变更')

    const original = await readGitOriginal(cwd, path, file)
    const modified = await readGitModified(cwd, path, file)
    const binary = original.binary || modified.binary
    const message = binary ? 'Binary file cannot be displayed as text.' : undefined
    return {
      path,
      original: original.content,
      modified: modified.content,
      status: file,
      binary,
      message
    }
  }

  async getGitFileHunks(path: string, rootPath?: string, staged = false): Promise<WorkspaceGitFileHunks> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    const file = await getGitFileStatus(cwd, path)
    if (!file) throw new Error('未找到文件变更')
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) {
      return { path, status: file, binary: true, hunks: [] }
    }

    const diffArgs = staged
      ? ['diff', '--no-ext-diff', '--cached', '--unified=4', '--', path]
      : ['diff', '--no-ext-diff', '--unified=4', '--', path]
    const { stdout } = await execGit(cwd, diffArgs)

    return {
      path,
      status: file,
      hunks: parseUnifiedDiffHunks(stdout)
    }
  }

  async getGitDiffSummary(rootPath?: string): Promise<string> {
    const status = await this.getGitStatus(rootPath)
    if (!status.isRepository) return 'No Git repository.'
    const files = status.files ?? []
    if (!files.length) return `Branch ${status.branch ?? 'HEAD'} is clean.`
    return [
      `Branch: ${status.branch ?? 'HEAD'}`,
      `HEAD: ${status.head ?? 'unknown'}`,
      `Upstream: ${status.upstream ?? 'not set'}`,
      `Ahead/behind: ${status.ahead ?? 0}/${status.behind ?? 0}`,
      `Changes: ${files.length} (${summarizeGitStatus(files)})`,
      ...files.slice(0, 60).map((file) => `- ${file.index}${file.workingTree} ${file.path}`)
    ].join('\n')
  }

  async suggestCommitMessage(rootPath?: string): Promise<string> {
    const status = await this.getGitStatus(rootPath)
    if (!status.isRepository || !status.files?.length) return ''
    const fallback = suggestCommitMessageFromStatus(status.files)
    try {
      const diffSummary = await this.getGitDiffSummary(rootPath)
      return await aiService.summarizeCommitMessage({
        branch: status.branch,
        diffSummary,
        fallback
      })
    } catch {
      return fallback
    }
  }

  async reviewGitChanges(rootPath?: string): Promise<WorkspaceGitReviewResult> {
    const cwd = rootPath ?? this.workspace?.rootPath
    const generatedAt = Date.now()
    if (!cwd) throw new Error('请先打开工作区')

    const status = await this.getGitStatus(cwd)
    if (!status.isRepository) {
      return {
        summary: 'Current workspace is not a Git repository.',
        generatedAt,
        fallback: true
      }
    }
    if (!status.files?.length) {
      return {
        summary: 'No changes to review.',
        generatedAt,
        fallback: true
      }
    }

    const diffSummary = await this.getGitDiffSummary(cwd)
    const diffExcerpt = await this.getGitDiffExcerpt(cwd)
    try {
      const summary = await aiService.reviewGitDiff({
        branch: status.branch,
        diffSummary,
        diffExcerpt
      })
      return {
        summary: summary || buildFallbackReview(status.files),
        generatedAt,
        fallback: !summary
      }
    } catch {
      return {
        summary: buildFallbackReview(status.files),
        generatedAt,
        fallback: true
      }
    }
  }

  async stageGitFile(path: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    await execGitLocked(cwd, ['add', '--', path])
    return this.getGitStatus(cwd)
  }

  async unstageGitFile(path: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    await execGitLocked(cwd, ['restore', '--staged', '--', path])
    return this.getGitStatus(cwd)
  }

  async stageGitHunk(path: string, hunkIndex: number, rootPath?: string, staged = false): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    // 读 hunk 与 apply 必须原子：期间若有其它写操作改动 diff，行号会错位
    await withRepoLock(cwd, async () => {
      const hunks = await this.getGitFileHunks(path, cwd, staged)
      const hunk = hunks.hunks[hunkIndex]
      if (!hunk) throw new Error('未找到变更块')
      await applyGitPatch(cwd, buildHunkPatch(path, hunk), ['--cached'])
    })
    return this.getGitStatus(cwd)
  }

  async unstageGitHunk(path: string, hunkIndex: number, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    await withRepoLock(cwd, async () => {
      const hunks = await this.getGitFileHunks(path, cwd, true)
      const hunk = hunks.hunks[hunkIndex]
      if (!hunk) throw new Error('未找到已暂存的变更块')
      await applyGitPatch(cwd, buildHunkPatch(path, hunk, true), ['--cached', '--reverse'])
    })
    return this.getGitStatus(cwd)
  }

  async fetchGit(rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    await execGitLocked(cwd, ['fetch', '--prune'])
    return this.getGitStatus(cwd)
  }

  async getGitConflictFile(path: string, rootPath?: string): Promise<WorkspaceGitConflictFile> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    const working = await readGitStage(cwd, path, 0)
    const base = await readGitStage(cwd, path, 1)
    const ours = await readGitStage(cwd, path, 2)
    const theirs = await readGitStage(cwd, path, 3)
    const parsed = parseGitConflictMarkers(working)

    return {
      path,
      working,
      base: base || ours,
      ours: ours || working,
      theirs: theirs || working,
      hasConflictMarkers: parsed.hasMarkers
    }
  }

  async resolveGitConflictFile(path: string, content: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    await fileService.writeFile(path, content)
    await execGitLocked(cwd, ['add', '--', path])
    return this.getGitStatus(cwd)
  }

  async pullGit(rootPath?: string): Promise<WorkspaceGitSyncResult> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    const { stdout, stderr } = await execGitLocked(cwd, ['pull', '--rebase=false'])
    const status = await this.getGitStatus(cwd)
    return {
      summary: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Pull completed.',
      status
    }
  }

  async pushGit(rootPath?: string, setUpstream = false): Promise<WorkspaceGitSyncResult> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    const args = setUpstream ? ['push', '-u', 'origin', 'HEAD'] : ['push']
    const { stdout, stderr } = await execGitLocked(cwd, args)
    const status = await this.getGitStatus(cwd)
    return {
      summary: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || 'Push completed.',
      status
    }
  }

  async discardGitFile(path: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    assertSafeGitPath(path)

    await withRepoLock(cwd, async () => {
      const file = await getGitFileStatus(cwd, path)
      if (!file) return

      if (file.index === '?' || file.workingTree === '?') {
        await execGit(cwd, ['clean', '-fd', '--', path], { readOnly: false })
      } else if (file.index === 'A') {
        await execGit(cwd, ['restore', '--staged', '--', path], { readOnly: false })
        await execGit(cwd, ['clean', '-fd', '--', path], { readOnly: false })
      } else if (file.index === 'R' && file.previousPath) {
        // 重命名：撤销需同时恢复旧路径（内容回来）并清掉新路径文件
        await execGit(cwd, ['restore', '--staged', '--', file.previousPath, path], { readOnly: false })
        await execGit(cwd, ['restore', '--worktree', '--', file.previousPath], { readOnly: false })
        await execGit(cwd, ['clean', '-fd', '--', path], { readOnly: false })
      } else {
        await execGit(cwd, ['restore', '--staged', '--worktree', '--', path], { readOnly: false })
      }
    })
    return this.getGitStatus(cwd)
  }

  async commitAll(message: string, rootPath?: string, amend = false): Promise<WorkspaceGitCommitResult> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    const cleanMessage = message.trim()
    if (!cleanMessage) throw new Error('提交信息不能为空')

    const { stdout, stderr } = await withRepoLock(cwd, async () => {
      const before = await this.getGitStatus(cwd)
      if (!before.dirtyCount && !amend) throw new Error('没有可提交的变更')
      await execGit(cwd, ['add', '-A'], { readOnly: false })
      return execGit(cwd, buildCommitArgs(cleanMessage, amend), { readOnly: false })
    })
    const status = await this.getGitStatus(cwd)
    const commit = await getGitHead(cwd)
    return {
      commit,
      summary: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
      status
    }
  }

  async commitStaged(message: string, rootPath?: string, amend = false): Promise<WorkspaceGitCommitResult> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')
    const cleanMessage = message.trim()
    if (!cleanMessage) throw new Error('提交信息不能为空')

    const staged = (await this.getGitStatus(cwd)).files?.filter((file) => file.index !== ' ' && file.index !== '?') ?? []
    if (!staged.length && !amend) throw new Error('没有已暂存的变更')

    const { stdout, stderr } = await execGitLocked(cwd, buildCommitArgs(cleanMessage, amend))
    const status = await this.getGitStatus(cwd)
    const commit = await getGitHead(cwd)
    return {
      commit,
      summary: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
      status
    }
  }

  /** 列出 stash 记录（索引、描述、相对时间） */
  async listGitStashes(rootPath?: string): Promise<WorkspaceGitStashEntry[]> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd || !(await isGitRepository(cwd))) return []
    try {
      const { stdout } = await execGit(cwd, ['stash', 'list', '--format=%gd|%cr|%gs'])
      return parseGitStashList(stdout)
    } catch {
      return []
    }
  }

  /** 暂存当前修改到 stash（包含未跟踪文件，与 VS Code 默认一致） */
  async pushGitStash(message: string, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    const args = ['stash', 'push', '--include-untracked']
    const cleanMessage = message.trim()
    if (cleanMessage) args.push('-m', cleanMessage)
    await execGitLocked(cwd, args)
    return this.getGitStatus(cwd)
  }

  /**
   * 应用 stash。
   * @param index - stash 序号（stash@{index}）
   * @param pop   - true 时应用后删除该记录（pop），false 仅应用（apply）
   */
  async applyGitStash(index: number, pop: boolean, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    await execGitLocked(cwd, ['stash', pop ? 'pop' : 'apply', formatStashRef(index)])
    return this.getGitStatus(cwd)
  }

  /** 删除一条 stash 记录 */
  async dropGitStash(index: number, rootPath?: string): Promise<WorkspaceGitStatus> {
    const cwd = rootPath ?? this.workspace?.rootPath
    if (!cwd) throw new Error('请先打开工作区')
    if (!(await isGitRepository(cwd))) throw new Error('当前项目不是 Git 仓库')

    await execGitLocked(cwd, ['stash', 'drop', formatStashRef(index)])
    return this.getGitStatus(cwd)
  }

  private async getGitDiffExcerpt(cwd: string): Promise<string> {
    const chunks: string[] = []
    const commands: string[][] = [
      ['diff', '--stat', '--no-ext-diff'],
      ['diff', '--no-ext-diff', '--unified=3'],
      ['diff', '--cached', '--no-ext-diff', '--unified=3']
    ]

    for (const args of commands) {
      try {
        const { stdout } = await execGit(cwd, args)
        const trimmed = stdout.trim()
        if (trimmed) chunks.push(`$ git ${args.join(' ')}\n${trimmed}`)
      } catch {
        // Keep review resilient; status summary still provides useful context.
      }
    }

    return chunks.join('\n\n') || 'No text diff available. Files may be binary, untracked, or too large.'
  }
}

export const workspaceService = new WorkspaceService()

export const workspaceServiceInternalsForTest = {
  parseGitStatus,
  parseGitGraph,
  parseGitStashList
}

function parseGitGraph(stdout: string): WorkspaceGitGraphLine[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^([*|/\\\-+\s]*)\s+([0-9a-f]+)\s+(.*)$/i)
      if (!match) return { graph: '', hash: '', subject: raw.trim(), raw }
      return {
        graph: match[1] ?? '',
        hash: match[2] ?? '',
        subject: match[3] ?? '',
        raw
      }
    })
}

function sanitizeBranchName(branch: string): string {
  const trimmed = branch.trim()
  if (!trimmed) throw new Error('分支名称不能为空')
  if (trimmed.startsWith('-') || trimmed.includes('..') || trimmed.endsWith('/') || /[\s~^:?*[\\]/.test(trimmed)) {
    throw new Error(`非法分支名称: ${branch}`)
  }
  return trimmed
}

function assertSafeGitPath(path: string): void {
  const normalized = path.trim()
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('非法文件路径')
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('非法文件路径')
  }
}

function emptyGitStatus(): WorkspaceGitStatus {
  return {
    branch: null,
    dirtyCount: 0,
    isRepository: false,
    head: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: []
  }
}

function buildFallbackReview(files: WorkspaceGitFileStatus[]): string {
  const summary = summarizeGitStatus(files)
  const samples = files.slice(0, 12).map((file) => `- ${file.index}${file.workingTree} ${file.path}`)
  return [
    'Findings:',
    '- [info] AI review is unavailable, so only a deterministic Git status review was produced.',
    `- [info] Changed files: ${files.length} (${summary}).`,
    '',
    'Files:',
    ...samples,
    files.length > samples.length ? `- ... ${files.length - samples.length} more` : '',
    '',
    'Verification:',
    '- Run the relevant unit tests, type-check, and build before committing.',
    '- Open changed files or hunks to inspect behavior-sensitive edits.'
  ].filter(Boolean).join('\n')
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(cwd, ['rev-parse', '--short', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function getGitUpstream(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

function parseGitStatus(stdout: string): { files: WorkspaceGitFileStatus[]; ahead: number; behind: number } {
  let ahead = 0
  let behind = 0
  const files: WorkspaceGitFileStatus[] = []
  const records = stdout.includes('\0')
    ? stdout.split('\0').filter(Boolean)
    : stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean)

  for (let i = 0; i < records.length; i += 1) {
    const line = records[i] ?? ''
    if (line.startsWith('##')) {
      const aheadMatch = line.match(/ahead (\d+)/)
      const behindMatch = line.match(/behind (\d+)/)
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      behind = behindMatch ? Number(behindMatch[1]) : 0
      continue
    }
    const index = line[0] ?? ' '
    const workingTree = line[1] ?? ' '
    const parsedPath = parseStatusPath(line.slice(3), stdout.includes('\0') ? records[i + 1] : undefined)
    if (stdout.includes('\0') && (index === 'R' || workingTree === 'R' || index === 'C' || workingTree === 'C')) {
      i += 1
    }
    if (parsedPath.path) files.push({ ...parsedPath, index, workingTree, conflicted: isGitConflict({ ...parsedPath, index, workingTree }) })
  }

  return { files, ahead, behind }
}

function parseStatusPath(path: string, previousPath?: string): Pick<WorkspaceGitFileStatus, 'path' | 'previousPath'> {
  if (previousPath) return { previousPath, path }
  const renamed = path.match(/^(.+?) -> (.+)$/)
  if (renamed?.[1] && renamed[2]) {
    return { previousPath: renamed[1], path: renamed[2] }
  }
  return { path }
}

/**
 * 定点查询单个文件的 git 状态（含 rename 前路径）。
 * 相比全量 getGitStatus，避免 diff/hunks/discard 每次扫描整个仓库。
 */
async function getGitFileStatus(cwd: string, path: string): Promise<WorkspaceGitFileStatus | null> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z', '--', path])
  const { files } = parseGitStatus(stdout)
  return files.find((item) => item.path === path || item.previousPath === path) ?? null
}

function buildCommitArgs(message: string, amend: boolean): string[] {
  const args = ['commit', '-m', message]
  if (amend) args.push('--amend')
  return args
}

/** stash 序号必须是非负整数，拼引用前校验，杜绝注入 */
function formatStashRef(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`非法 stash 序号: ${index}`)
  return `stash@{${index}}`
}

/** 解析 `git stash list --format=%gd|%cr|%gs` 输出 */
function parseGitStashList(stdout: string): WorkspaceGitStashEntry[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref = '', relativeTime = '', ...rest] = line.split('|')
      const indexMatch = ref.match(/stash@\{(\d+)\}/)
      return {
        index: indexMatch ? Number(indexMatch[1]) : 0,
        description: rest.join('|').trim(),
        relativeTime: relativeTime.trim()
      }
    })
    .filter((entry) => Number.isInteger(entry.index))
}

function editorStatePrefKey(rootPath: string): string {
  return `${EDITOR_STATE_PREF_PREFIX}${createHash('sha1').update(resolve(rootPath)).digest('hex')}`
}

function sanitizeEditorWorkspaceState(value: unknown, rootPath: string): EditorWorkspaceState | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<EditorWorkspaceState>
  const cwd = resolve(rootPath)
  const seen = new Set<string>()
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs
      .map((tab) => (tab && typeof tab.path === 'string' ? resolve(tab.path) : null))
      .filter((path): path is string => path !== null && isInsideWorkspace(path, cwd))
      .filter((path) => {
        if (seen.has(path)) return false
        seen.add(path)
        return true
      })
      .slice(0, 50)
      .map((path) => ({ path }))
    : []

  const activeTabPath = typeof raw.activeTabPath === 'string' ? resolve(raw.activeTabPath) : null
  const secondaryTabPath = typeof raw.secondaryTabPath === 'string' ? resolve(raw.secondaryTabPath) : null
  const splitRatio = typeof raw.splitRatio === 'number' && Number.isFinite(raw.splitRatio)
    ? Math.min(0.8, Math.max(0.2, raw.splitRatio))
    : 0.5

  return {
    version: 1,
    tabs,
    activeTabPath: activeTabPath && seen.has(activeTabPath) ? activeTabPath : tabs[0]?.path ?? null,
    splitEnabled: Boolean(raw.splitEnabled && secondaryTabPath && seen.has(secondaryTabPath)),
    secondaryTabPath: secondaryTabPath && seen.has(secondaryTabPath) ? secondaryTabPath : null,
    splitRatio,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

function isInsideWorkspace(path: string, rootPath: string): boolean {
  const rel = relative(rootPath, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\'))
}

/** 应用补丁（调用方需已持有仓库锁） */
async function applyGitPatch(cwd: string, patch: string, extraArgs: string[]): Promise<void> {
  const patchFile = join(tmpdir(), `lucky-git-patch-${Date.now()}.patch`)
  await writeFile(patchFile, patch, 'utf8')
  try {
    await execGit(cwd, ['apply', ...extraArgs, patchFile], { readOnly: false })
  } finally {
    await unlink(patchFile).catch(() => undefined)
  }
}

async function readGitStage(cwd: string, path: string, stage: 0 | 1 | 2 | 3): Promise<string> {
  if (stage === 0) {
    try {
      const buffer = await readFile(securityService.resolveSafePath(path))
      return buffer.toString('utf-8')
    } catch {
      return ''
    }
  }
  try {
    const { stdout } = await execGit(cwd, ['show', `:${stage}:${path}`])
    return stdout
  } catch {
    return ''
  }
}

async function readGitOriginal(
  cwd: string,
  path: string,
  status: WorkspaceGitFileStatus
): Promise<{ content: string; binary: boolean }> {
  if (status.index === '?' || status.workingTree === '?' || status.index === 'A') {
    return { content: '', binary: false }
  }
  const gitPath = status.previousPath ?? path
  try {
    const stdout = await execGitBuffer(cwd, ['show', `HEAD:${gitPath}`])
    return decodeDiffBuffer(stdout, gitPath)
  } catch {
    return { content: '', binary: false }
  }
}

async function readGitModified(
  cwd: string,
  path: string,
  status: WorkspaceGitFileStatus
): Promise<{ content: string; binary: boolean }> {
  if (status.index === 'D' || status.workingTree === 'D') {
    return { content: '', binary: false }
  }
  try {
    const buffer = await readFile(securityService.resolveSafePath(path))
    return decodeDiffBuffer(buffer, path)
  } catch {
    try {
      const stdout = await execGitBuffer(cwd, ['show', `:${path}`])
      return decodeDiffBuffer(stdout, path)
    } catch {
      return { content: '', binary: false }
    }
  }
}

function decodeDiffBuffer(buffer: Buffer, path: string): { content: string; binary: boolean } {
  if (isLikelyBinary(path, buffer)) {
    return { content: '[Binary file]', binary: true }
  }
  if (buffer.byteLength > DIFF_MAX_TEXT_BYTES) {
    return {
      content: `${buffer.subarray(0, DIFF_MAX_TEXT_BYTES).toString('utf-8')}\n\n[File truncated for preview]`,
      binary: false
    }
  }
  return { content: buffer.toString('utf-8'), binary: false }
}

function isLikelyBinary(path: string, buffer: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return true
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 8000))
  return sample.includes(0)
}
