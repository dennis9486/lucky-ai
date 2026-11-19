/**
 * 工作区 Git 面板链路 E2E — 覆盖 Code Workbench Git 面板背后的主进程链：
 * workspace.set（真实 git 仓库）→ file.write 修改 → getGitStatus 识别变更 →
 * getGitFileDiff 给出 original/modified → discardGitFile 还原工作区。
 *
 * 仓库由测试进程用真实 git 命令搭建（identity 用 -c 内联，不动全局配置），
 * 走的是 workspace.service + git-exec 的完整真实路径。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const ORIGINAL_CONTENT = 'hello original\n'
const MODIFIED_CONTENT = 'hello modified\n'

let app: ElectronApplication
let window: Page
let repoDir: string

function git(args: string[], cwd: string): void {
  execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@test.local', ...args], { cwd })
}

test.beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'lucky-e2e-git-'))
  writeFileSync(join(repoDir, 'demo.txt'), ORIGINAL_CONTENT, 'utf-8')
  git(['init'], repoDir)
  git(['add', '-A'], repoDir)
  git(['commit', '-m', 'init'], repoDir)

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LUCKY_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'lucky-e2e-git-data-'))
    }
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('git status/diff/discard roundtrip through real IPC on a real repository', async () => {
  test.setTimeout(120_000)

  const result = await window.evaluate(async ({ rootPath, filePath, modified, original }) => {
    const api = (window as unknown as {
      luckyAI: {
        workspace: {
          set: (rootPath: string) => Promise<{ success: boolean; error?: string }>
          getGitStatus: (rootPath?: string) => Promise<{
            success: boolean
            data?: { isRepository: boolean; files: Array<{ path: string; worktreeStatus?: string; status?: string }> }
            error?: string
          }>
          getGitFileDiff: (path: string, rootPath?: string) => Promise<{
            success: boolean
            data?: { original: string; modified: string; binary?: boolean }
            error?: string
          }>
          discardGitFile: (path: string, rootPath?: string) => Promise<{ success: boolean; error?: string }>
        }
        file: {
          read: (path: string) => Promise<{ success: boolean; data?: { content: string }; error?: string }>
          write: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
        }
      }
    }).luckyAI

    const ws = await api.workspace.set(rootPath)
    if (!ws.success) return { phase: 'workspace', error: ws.error }

    const cleanStatus = await api.workspace.getGitStatus(rootPath)
    if (!cleanStatus.success) return { phase: 'status-clean', error: cleanStatus.error }

    const write = await api.file.write(filePath, modified)
    if (!write.success) return { phase: 'write', error: write.error }

    const dirtyStatus = await api.workspace.getGitStatus(rootPath)
    if (!dirtyStatus.success) return { phase: 'status-dirty', error: dirtyStatus.error }

    const diff = await api.workspace.getGitFileDiff('demo.txt', rootPath)
    if (!diff.success) return { phase: 'diff', error: diff.error }

    const discard = await api.workspace.discardGitFile('demo.txt', rootPath)
    if (!discard.success) return { phase: 'discard', error: discard.error }

    const restored = await api.file.read(filePath)
    if (!restored.success) return { phase: 'read-back', error: restored.error }

    return {
      phase: 'done',
      isRepository: cleanStatus.data?.isRepository ?? false,
      cleanFileCount: cleanStatus.data?.files.length ?? -1,
      dirtyFiles: dirtyStatus.data?.files.map((file) => file.path) ?? [],
      diffOriginal: diff.data?.original,
      diffModified: diff.data?.modified,
      restoredContent: restored.data?.content,
      expectedOriginal: original
    }
  }, {
    rootPath: repoDir,
    filePath: join(repoDir, 'demo.txt'),
    modified: MODIFIED_CONTENT,
    original: ORIGINAL_CONTENT
  })

  expect(result.phase).toBe('done')
  expect(result.isRepository).toBe(true)
  expect(result.cleanFileCount).toBe(0)
  expect(result.dirtyFiles).toContain('demo.txt')
  expect(result.diffOriginal).toBe(ORIGINAL_CONTENT)
  expect(result.diffModified).toBe(MODIFIED_CONTENT)
  expect(result.restoredContent).toBe(ORIGINAL_CONTENT)
})
