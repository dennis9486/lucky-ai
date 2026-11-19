import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execGit } from '../services/git-exec.js'
import { parallelTasksInternalsForTest } from './parallel-tasks.js'

const { createTaskWorktree, collectWorktreeDiff, removeTaskWorktree, guardWithin } = parallelTasksInternalsForTest

describe('parallel task worktree lifecycle', () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'ptask-repo-'))
    await execGit(repo, ['init'], { readOnly: false })
    await execGit(repo, ['config', 'user.email', 'test@test.local'], { readOnly: false })
    await execGit(repo, ['config', 'user.name', 'test'], { readOnly: false })
    await writeFile(join(repo, 'a.txt'), 'original\n')
    await execGit(repo, ['add', '-A'], { readOnly: false })
    await execGit(repo, ['commit', '-m', 'init'], { readOnly: false })
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('creates an isolated detached worktree, collects diff, and cleans up', async () => {
    const worktree = await createTaskWorktree(repo)
    try {
      expect(existsSync(join(worktree, 'a.txt'))).toBe(true)

      // 副本内修改 + 新增文件
      await writeFile(join(worktree, 'a.txt'), 'modified\n')
      await writeFile(join(worktree, 'b.txt'), 'created\n')

      const diff = await collectWorktreeDiff(worktree)
      expect(diff).toContain('a/a.txt')
      expect(diff).toContain('+modified')
      expect(diff).toContain('b/b.txt')
      expect(diff).toContain('+created')

      // 主工作区不受影响
      expect(await readFile(join(repo, 'a.txt'), 'utf-8')).toBe('original\n')
      expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    } finally {
      await removeTaskWorktree(repo, worktree)
    }

    expect(existsSync(worktree)).toBe(false)
    // 仓库侧 worktree 记录已清理
    const { stdout } = await execGit(repo, ['worktree', 'list'])
    expect(stdout.trim().split('\n')).toHaveLength(1)
  })

  it('collected diff applies cleanly onto the main working tree', async () => {
    const worktree = await createTaskWorktree(repo)
    let diff = ''
    try {
      await writeFile(join(worktree, 'a.txt'), 'patched\n')
      diff = await collectWorktreeDiff(worktree)
    } finally {
      await removeTaskWorktree(repo, worktree)
    }

    // 模拟主 Agent 的落地路径：git apply
    const patchFile = join(repo, '.task.patch')
    await writeFile(patchFile, `${diff}\n`)
    await execGit(repo, ['apply', '.task.patch'], { readOnly: false })
    expect(await readFile(join(repo, 'a.txt'), 'utf-8')).toBe('patched\n')
  })

  it('guardWithin anchors paths to the worktree and rejects escapes', () => {
    const root = '/tmp/wt-abc'
    const input: Record<string, unknown> = { file_path: 'src/a.ts' }
    guardWithin(root, input)
    expect(input.file_path).toBe('/tmp/wt-abc/src/a.ts')

    expect(() => guardWithin(root, { file_path: '../outside.ts' })).toThrow(/不在任务副本内/)
    expect(() => guardWithin(root, { path: '/etc/passwd' })).toThrow(/不在任务副本内/)
  })
})
