/**
 * parallel-tasks.ts — 并行可写子代理（git worktree 隔离）
 *
 * 与只读 RunSubagents 互补：每个任务在独立的 **detached git worktree**
 * （工作区的隔离副本）中运行一个可写子代理（Read/Write/Edit/Glob/Grep，
 * 无 shell），互不干扰、绝不触碰用户工作区。任务结束后收集 worktree 的
 * git diff 返回主 Agent，由主 Agent 审阅后用 `git apply` 选择性落地——
 * 这一步走 Bash 工具，天然复用沙箱与用户确认（HITL）链路。
 *
 * 隔离与安全：
 * - worktree 建在系统临时目录（不污染仓库），detached HEAD（不产生分支）。
 * - 子代理文件工具的路径守卫锚定各自 worktree（不经 securityService——
 *   它锚定的是主工作区）。
 * - worktree 的创建/删除会写 .git，经 withRepoLock 串行化。
 * - 无论成败，worktree 用后即删（diff 已捕获为文本）。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Toolkit, Read, Write, Edit, Glob, Grep } from '@agentscope-ai/agentscope/tool'
import type { Tool } from '@agentscope-ai/agentscope/tool'
import { Agent } from '@agentscope-ai/agentscope/agent'
import { EventType } from '@agentscope-ai/agentscope/event'
import { createMsg } from '@agentscope-ai/agentscope/message'
import { createChatModel } from './model-factory.js'
import { settingsService } from '../services/settings.service.js'
import { workspaceService } from '../services/workspace.service.js'
import { execGit, withRepoLock } from '../services/git-exec.js'
import { createLogger } from '../../shared/utils/log.js'
import { redactSecrets } from '../../shared/utils/secret-redactor.js'

const logger = createLogger('main/parallel-tasks')

/** 并行可写任务上限（写任务成本高于只读探索，保守限流） */
const MAX_PARALLEL_TASKS = 3
const TASK_MAX_ITERS = 12
/** 单任务 diff 返回上限（超出截断，完整改动仍可通过重跑单任务获得） */
const MAX_DIFF_CHARS = 60_000

const TASK_PROMPT = `You are a focused coding sub-agent working in an ISOLATED COPY of the repository (a temporary git worktree).
Implement the assigned task by editing files with Write/Edit; use Read/Glob/Grep to explore. There is no shell — verify by reading code.
Your changes never touch the user's working tree directly: they are collected as a git diff and reviewed by the main agent.
Keep edits scoped to the task. Finish with a short report: what you changed, where, and anything the reviewer must know.`

export interface ParallelTaskResult {
  task: string
  report: string
  /** 该任务在隔离副本中的全部改动（unified diff，相对仓库根） */
  diff: string
  error?: string
}

/** 路径守卫：锚定指定 worktree 根，越界即拒绝 */
function guardWithin(rootPath: string, input: Record<string, unknown>): void {
  for (const key of ['file_path', 'path'] as const) {
    const raw = input[key]
    if (typeof raw !== 'string') continue
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(rootPath, raw)
    const rel = relative(rootPath, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`路径不在任务副本内: ${raw}`)
    }
    input[key] = abs
  }
}

function scopedTool(tool: Tool, rootPath: string): Tool {
  const originalCall = tool.call?.bind(tool)
  return {
    ...tool,
    requireUserConfirm: false, // 隔离副本内自动执行；落地时机由主 Agent 的 HITL 把关
    call: ((input: Record<string, unknown>) => {
      guardWithin(rootPath, input)
      if (!originalCall) throw new Error(`工具 ${tool.name} 不支持本地执行`)
      return originalCall(input as never)
    }) as Tool['call']
  }
}

function buildWritableToolkit(rootPath: string): Toolkit {
  return new Toolkit({
    tools: [Read(), Write(), Edit(), Glob(), Grep()].map((tool) => scopedTool(tool, rootPath))
  })
}

/** 创建 detached worktree（.git 写操作走仓库锁） */
async function createTaskWorktree(repoRoot: string): Promise<string> {
  const dir = join(tmpdir(), 'lucky-worktrees', `task-${randomUUID().slice(0, 8)}`)
  await mkdir(join(tmpdir(), 'lucky-worktrees'), { recursive: true })
  await withRepoLock(repoRoot, () =>
    execGit(repoRoot, ['worktree', 'add', '--detach', dir, 'HEAD'], { readOnly: false })
  )
  return dir
}

/** 收集 worktree 全部改动（先 add -A 使新文件进入 diff；副本一次性，暂存无副作用） */
async function collectWorktreeDiff(worktreeDir: string): Promise<string> {
  await execGit(worktreeDir, ['add', '-A'], { readOnly: false })
  const { stdout } = await execGit(worktreeDir, ['diff', '--cached', '--no-ext-diff'])
  const diff = stdout.trim()
  if (diff.length > MAX_DIFF_CHARS) {
    return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated - exceeded ${MAX_DIFF_CHARS} characters]`
  }
  return diff
}

/** 删除 worktree（失败仅告警——临时目录残留可被系统清理，且 prune 兜底） */
async function removeTaskWorktree(repoRoot: string, worktreeDir: string): Promise<void> {
  try {
    await withRepoLock(repoRoot, () =>
      execGit(repoRoot, ['worktree', 'remove', '--force', worktreeDir], { readOnly: false })
    )
  } catch (e) {
    logger.warn('remove worktree failed, falling back to rm + prune', { worktreeDir, error: String(e) })
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => undefined)
    await withRepoLock(repoRoot, () =>
      execGit(repoRoot, ['worktree', 'prune'], { readOnly: false })
    ).catch(() => undefined)
  }
}

async function runOneTask(
  repoRoot: string,
  task: string,
  provider: Parameters<typeof createChatModel>[0],
  getAbortSignal?: () => AbortSignal | undefined
): Promise<ParallelTaskResult> {
  let worktreeDir: string | null = null
  try {
    if (getAbortSignal?.()?.aborted) {
      return { task, report: '', diff: '', error: 'aborted by user' }
    }
    worktreeDir = await createTaskWorktree(repoRoot)
    const agent = new Agent({
      name: 'TaskAgent',
      sysPrompt: `${TASK_PROMPT}\n\nWorktree root: ${worktreeDir}`,
      model: createChatModel(provider, { getAbortSignal }),
      maxIters: TASK_MAX_ITERS,
      toolkit: buildWritableToolkit(worktreeDir)
    })

    let report = ''
    for await (const event of agent.replyStream({
      msgs: createMsg({ role: 'user', name: 'user', content: task })
    })) {
      if (getAbortSignal?.()?.aborted) break
      if (event.type === EventType.TEXT_BLOCK_DELTA) report += event.delta ?? ''
    }

    if (getAbortSignal?.()?.aborted) {
      return { task, report: '', diff: '', error: 'aborted by user' }
    }

    const diff = redactSecrets(await collectWorktreeDiff(worktreeDir)).text
    return { task, report: report.trim() || '(no report)', diff }
  } catch (error) {
    logger.warn('parallel task failed', { task, error })
    return { task, report: '', diff: '', error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (worktreeDir) await removeTaskWorktree(repoRoot, worktreeDir)
  }
}

/**
 * 并行运行多个可写任务（上限 MAX_PARALLEL_TASKS）。
 * 要求当前工作区是 Git 仓库（worktree 是隔离机制的前提）。
 */
export async function runParallelTasks(
  tasks: string[],
  options?: { getAbortSignal?: () => AbortSignal | undefined }
): Promise<ParallelTaskResult[]> {
  const repoRoot = workspaceService.getWorkspace()?.rootPath
  if (!repoRoot) throw new Error('请先打开工作区')
  try {
    await execGit(repoRoot, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error('并行任务需要 Git 仓库（worktree 隔离依赖 git）')
  }

  const provider = await settingsService.getActiveProvider()
  if (!provider) throw new Error('未配置 AI Provider')

  const bounded = tasks
    .map((task) => String(task ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_PARALLEL_TASKS)
  if (!bounded.length) return []

  logger.info('run parallel worktree tasks', { count: bounded.length })
  return Promise.all(bounded.map((task) => runOneTask(repoRoot, task, provider, options?.getAbortSignal)))
}

/** 仅测试使用 */
export const parallelTasksInternalsForTest = {
  createTaskWorktree,
  collectWorktreeDiff,
  removeTaskWorktree,
  guardWithin
}
