import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../../shared/utils/log.js'

/**
 * 自我改进的技能（procedural memory）—— 对齐 Hermes 的「闭环学习」。
 *
 * Agent 跑通一个多步任务后，可用 CreateSkill 工具把「何时用 / 步骤 / 命令」蒸馏成一条技能存到
 * 本目录；下次构建 Agent 时 readLearnedSkills() 读回并注入系统提示，从而复用、随使用精炼。
 * 走**提示注入**而非依赖 AgentScope 的 skill 扫描器，格式完全自控、加载可靠。
 * 注意上下文预算：注入前按 MAX_INJECT_CHARS 截断。
 */

const logger = createLogger('main/learned-skills')
const SKILLS_DIR = join(homedir(), '.lucky-ai', 'skills')
const MAX_INJECT_CHARS = 6000
const MAX_SKILL_CHARS = 4000

function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return base || 'skill'
}

export interface SaveSkillInput {
  name: string
  description: string
  content: string
}

/** 保存/覆盖一条技能，返回落盘文件路径。 */
export async function saveSkill(input: SaveSkillInput): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('技能名称不能为空')
  await mkdir(SKILLS_DIR, { recursive: true })
  const slug = slugify(name)
  const filePath = join(SKILLS_DIR, `${slug}.md`)
  const body = input.content.trim().slice(0, MAX_SKILL_CHARS)
  const md = `# ${name}\n\n> ${input.description.trim()}\n\n${body}\n`
  await writeFile(filePath, md, 'utf8')
  logger.info('save learned skill', { name, slug, filePath })
  return filePath
}

/** 读取全部已学技能，拼接后按预算截断，供注入系统提示。 */
export async function readLearnedSkills(): Promise<string> {
  if (!existsSync(SKILLS_DIR)) return ''
  let entries: string[]
  try {
    entries = (await readdir(SKILLS_DIR)).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return ''
  }
  const parts: string[] = []
  let total = 0
  for (const entry of entries) {
    if (total >= MAX_INJECT_CHARS) break
    let content: string
    try {
      content = (await readFile(join(SKILLS_DIR, entry), 'utf8')).trim()
    } catch {
      continue
    }
    if (!content) continue
    const remaining = MAX_INJECT_CHARS - total
    if (content.length > remaining) content = `${content.slice(0, remaining)}\n…[truncated]`
    parts.push(content)
    total += content.length
  }
  return parts.join('\n\n---\n\n')
}
