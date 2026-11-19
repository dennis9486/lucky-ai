import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 项目上下文文件 —— 对齐主流编码 Agent（Claude Code 的 CLAUDE.md、Cursor 的 rules）。
 *
 * 从工作区读取项目级指令文件并注入系统提示，让 Agent 天然懂这个项目的约定。
 * 关键约束（注意上下文预算）：所有文件合计**硬截断到 MAX_TOTAL_CHARS**，避免撑爆上下文窗口。
 */

/** 按优先级依次尝试；命中即收（去重靠文件系统只可能各存一份）。 */
const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', '.lucky/instructions.md', '.cursorrules'] as const
const MAX_TOTAL_CHARS = 8000

export async function readProjectContext(workspaceRoot: string | undefined | null): Promise<string> {
  if (!workspaceRoot) return ''
  const parts: string[] = []
  let total = 0
  for (const relative of CONTEXT_FILES) {
    if (total >= MAX_TOTAL_CHARS) break
    const filePath = join(workspaceRoot, relative)
    if (!existsSync(filePath)) continue
    let content: string
    try {
      content = (await readFile(filePath, 'utf8')).trim()
    } catch {
      continue
    }
    if (!content) continue
    const remaining = MAX_TOTAL_CHARS - total
    if (content.length > remaining) content = `${content.slice(0, remaining)}\n…[truncated]`
    parts.push(`### ${relative}\n${content}`)
    total += content.length
  }
  return parts.join('\n\n')
}
