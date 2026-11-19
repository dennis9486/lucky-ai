import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConfiguredSkill, SaveConfiguredSkillInput } from '../../shared/types/skill.js'
import { createLogger } from '../../shared/utils/log.js'

/**
 * 自我改进的技能（procedural memory）—— 对齐 Hermes 的「闭环学习」。
 *
 * Agent 跑通一个多步任务后，可用 CreateSkill 工具把「何时用 / 步骤 / 命令」蒸馏成一条技能存到
 * 本目录；设置页也可以直接编写。下次构建 Agent 时 readLearnedSkills() 读回已启用的技能并注入系统提示。
 * 走**提示注入**而非依赖 AgentScope 的 skill 扫描器，格式完全自控、加载可靠。
 * 注意上下文预算：注入前按 MAX_INJECT_CHARS 截断。
 */

const logger = createLogger('main/learned-skills')
const MAX_INJECT_CHARS = 6000
const MAX_SKILL_CHARS = 4000

export interface SaveSkillInput extends SaveConfiguredSkillInput {}

function skillsDir(): string {
  const override = process.env.LUCKY_SKILLS_DIR?.trim()
  return override || join(homedir(), '.lucky-ai', 'skills')
}

function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return base || 'skill'
}

function assertSkillId(id: string): string {
  const trimmed = id.trim()
  if (!/^[\w一-龥-]+$/.test(trimmed)) throw new Error('技能标识无效')
  return trimmed
}

function serializeSkill(input: SaveSkillInput): string {
  const enabled = input.enabled === false ? 'false' : 'true'
  const body = input.content.trim().slice(0, MAX_SKILL_CHARS)
  return `---\nenabled: ${enabled}\n---\n# ${input.name.trim()}\n\n> ${input.description.trim()}\n\n${body}\n`
}

function parseSkill(id: string, raw: string): ConfiguredSkill {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const enabled = frontmatter ? !/^\s*enabled:\s*false\s*$/im.test(frontmatter[1] ?? '') : true
  const body = (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim()
  const lines = body.split(/\r?\n/)
  let name = id
  let description = ''
  let start = 0
  if (lines[0]?.startsWith('# ')) {
    name = lines[0].slice(2).trim() || id
    start = 1
    if (lines[start]?.trim() === '') start += 1
    if (lines[start]?.startsWith('> ')) {
      description = lines[start].slice(2).trim()
      start += 1
      if (lines[start]?.trim() === '') start += 1
    }
  }
  return {
    id,
    name,
    description,
    content: lines.slice(start).join('\n').trim(),
    enabled
  }
}

async function readSkillFile(id: string): Promise<ConfiguredSkill | null> {
  const safeId = assertSkillId(id)
  try {
    const raw = await readFile(join(skillsDir(), `${safeId}.md`), 'utf8')
    return parseSkill(safeId, raw)
  } catch {
    return null
  }
}

/** 列出可在设置里编辑的技能。 */
export async function listConfiguredSkills(): Promise<ConfiguredSkill[]> {
  const dir = skillsDir()
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return []
  }
  const skills: ConfiguredSkill[] = []
  for (const entry of entries) {
    const id = entry.slice(0, -3)
    if (!/^[\w一-龥-]+$/.test(id)) continue
    try {
      skills.push(parseSkill(id, await readFile(join(dir, entry), 'utf8')))
    } catch {
      continue
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** 保存/覆盖一条技能，返回落盘文件路径。 */
export async function saveSkill(input: SaveSkillInput): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('技能名称不能为空')
  const dir = skillsDir()
  await mkdir(dir, { recursive: true })
  const slug = slugify(name)
  const filePath = join(dir, `${slug}.md`)
  const previousId = input.id?.trim()
  const previous = previousId ? await readSkillFile(previousId) : null
  await writeFile(
    filePath,
    serializeSkill({
      ...input,
      name,
      enabled: input.enabled ?? previous?.enabled ?? true
    }),
    'utf8'
  )
  if (previousId && previousId !== slug) {
    const oldPath = join(dir, `${assertSkillId(previousId)}.md`)
    if (oldPath !== filePath) await unlink(oldPath).catch(() => undefined)
  }
  logger.info('save learned skill', { name, slug })
  return filePath
}

/** 打开或关闭一条技能。关闭后不再注入系统提示。 */
export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const skill = await readSkillFile(id)
  if (!skill) throw new Error('技能不存在')
  await saveSkill({ ...skill, enabled })
}

/** 删除一条技能。 */
export async function deleteSkill(id: string): Promise<void> {
  const safeId = assertSkillId(id)
  await unlink(join(skillsDir(), `${safeId}.md`))
}

/** 读取已启用的技能，拼接后按预算截断，供注入系统提示。 */
export async function readLearnedSkills(): Promise<string> {
  const skills = (await listConfiguredSkills()).filter((skill) => skill.enabled)
  const parts: string[] = []
  let total = 0
  for (const skill of skills) {
    if (total >= MAX_INJECT_CHARS) break
    let content = `# ${skill.name}\n\n> ${skill.description}\n\n${skill.content}`.trim()
    if (!content) continue
    const remaining = MAX_INJECT_CHARS - total
    if (content.length > remaining) content = `${content.slice(0, remaining)}\n…[truncated]`
    parts.push(content)
    total += content.length
  }
  return parts.join('\n\n---\n\n')
}
