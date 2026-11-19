import type {
  AgentMemory,
  AgentMemoryStructuredFact,
  PersonalizationSettings
} from '../../shared/types/personalization.js'
import { detectMemoryIntents } from './memory-rules.js'
import {
  MEMORY_KEY_STOP_WORDS,
  normalize,
  normalizeForSearch,
  normalizeMemoryText,
  searchTokens,
  truncate
} from './memory-text.js'

/**
 * 记忆事实层：从对话文本抽取「值得记的事实」，并把事实规整到统一的槽位
 * （canonical key，如 personal:pet:name / project:branch）。
 * 槽位是记忆冲突检测与新旧交替（deprecation lineage）的主键。
 * 纯函数、无 DB 依赖；DB 侧的行级打分在 memory-retrieval.ts。
 */

export interface MemoryFactCandidate {
  content: string | null
  slot: string | null
  operation: 'add' | 'update' | 'noop'
}

export function buildMemoryContent(userMessage: string, assistantMessage: string): string {
  const userFact = memoryFactCandidate(userMessage).content
  if (userFact) {
    return userFact
  }
  return `用户曾询问「${truncate(userMessage, 140)}」，处理结论：${truncate(assistantMessage, 220)}`
}

export function normalizeMemoryForStorage(value: string): string {
  return repairGeneratedEchoMemory(value) ?? memoryFactCandidate(value).content ?? normalize(value)
}

export function shouldCapture(
  userMessage: string,
  assistantMessage: string,
  mode: PersonalizationSettings['memoryAutoCapture']
): boolean {
  const combined = `${userMessage}\n${assistantMessage}`
  const explicit = isDirectMemoryStatement(userMessage) || /记住|以后|偏好|喜欢|习惯|不要|总是|更正|纠正|不对|错了|改成|变成|变了|现在|当前|always|prefer|remember|never|correction|actually|instead|changed|now/i.test(combined)
  if (mode === 'explicit') return explicit
  if (explicit) return true
  if (mode === 'aggressive') {
    return combined.length >= 80
  }
  if (combined.length < 60) return false
  return explicit || /项目|架构|决定|约定|规范|decision|convention|workflow/i.test(combined)
}

export function inferKind(text: string): AgentMemory['kind'] {
  if (/偏好|喜欢|习惯|prefer/i.test(text)) return 'preference'
  if (/决定|decision|取舍|方案/i.test(text)) return 'decision'
  if (/项目|workspace|repo|模块|架构/i.test(text)) return 'project'
  if (/流程|workflow|步骤|规范|约定|规则|process|procedure|policy|rule/i.test(text)) return 'workflow'
  if (/指令|以后|总是|不要|always|never/i.test(text)) return 'instruction'
  return 'fact'
}

export function inferImportance(userMessage: string, assistantMessage: string): number {
  const text = `${userMessage}\n${assistantMessage}`
  if (/记住|以后|总是|不要|必须|重要|always|never|must/i.test(text)) return 5
  if (/项目|架构|决定|约定|规范/i.test(text)) return 4
  return 3
}

export function inferTags(text: string): string[] {
  const tags = new Set<string>()
  if (/ui|界面|样式|组件/i.test(text)) tags.add('ui')
  if (/agent|tool|mcp|工具/i.test(text)) tags.add('agent')
  if (/git|分支|commit/i.test(text)) tags.add('git')
  if (/爬虫|检索|web|crawl/i.test(text)) tags.add('web')
  return [...tags]
}

export function isDirectMemoryStatement(text: string): boolean {
  return Boolean(memoryFactCandidate(text).content)
}

export function memoryUpdateKey(text: string): string | null {
  if (isMemoryQuestion(text)) return null
  const candidate = memoryFactCandidate(text)
  const statement = candidate.content
  if (!statement) return null
  return candidate.slot ?? memoryConflictKey({
    kind: inferKind(statement),
    title: statement,
    content: statement,
    summary: statement,
    tags: inferTags(statement)
  })
}

export function memoryQuestionKey(text: string): string | null {
  if (!isMemoryQuestion(text)) return null
  return explicitMemorySlot(text)
}

export function repairGeneratedEchoMemory(content: string): string | null {
  const match = content.match(/用户曾询问「(.{1,500}?)」[，,]\s*处理结论[:：]/u)
  if (!match) return null
  return memoryFactCandidate(match[1]).content
}

export function buildStructuredFact(
  content: string,
  canonicalKey?: string,
  validFrom?: number,
  validTo?: number
): AgentMemoryStructuredFact | undefined {
  const key = canonicalKey || memoryConflictKey({
    kind: inferKind(content),
    title: content,
    content,
    summary: content,
    tags: inferTags(content)
  })
  if (!key) return undefined

  const parsed = parseCanonicalFactKey(key)
  const relation = parsed.relation || inferRelationFromContent(content)
  const subject = parsed.subject || normalizeSubjectAlias(extractSubjectHint(content, content) ?? 'general', content)
  const value = extractFactValue(content, relation, subject)
  if (!value) return undefined

  return {
    namespace: parsed.namespace,
    subject,
    relation,
    value,
    canonicalKey: key,
    evidence: truncate(content, 300),
    validFrom,
    validTo
  }
}

export function parseCanonicalFactKey(key: string): {
  namespace: AgentMemoryStructuredFact['namespace']
  subject: string
  relation: string
} {
  const [namespaceRaw = 'general', subjectRaw = 'general', relationRaw = 'value'] = key.split(':')
  const namespace = normalizeFactNamespace(namespaceRaw)
  return {
    namespace,
    subject: denormalizeSlotPart(subjectRaw),
    relation: relationRaw || 'value'
  }
}

function normalizeFactNamespace(value: string): AgentMemoryStructuredFact['namespace'] {
  if (value === 'personal') return 'personal'
  if (value === 'project') return 'project'
  if (value === 'preference') return 'preference'
  if (value === 'workflow') return 'workflow'
  if (value === 'decision') return 'decision'
  if (value === 'constraint') return 'constraint'
  return 'general'
}

function denormalizeSlotPart(value: string): string {
  return normalizeMemoryText(value.replace(/-/g, ' ')) || 'general'
}

function inferRelationFromContent(content: string): string {
  const slot = genericRelationSlot(content)
  if (slot) return parseCanonicalFactKey(slot).relation
  if (/(叫|名叫|称呼|called|named|call me)/i.test(content)) return 'name'
  if (/(喜欢|偏好|prefer|like)/i.test(content)) return 'preference'
  if (/(使用|用|uses?|use)/i.test(content)) return 'uses'
  if (/(默认|default)/i.test(content)) return 'default'
  if (/(必须|需要|must|should|required?)/i.test(content)) return 'requirement'
  if (/(不要|never|avoid)/i.test(content)) return 'constraint'
  return 'value'
}

function extractFactValue(content: string, relation: string, subject: string): string {
  const text = normalizeMemoryText(content)
  const patternsByRelation: Record<string, RegExp[]> = {
    name: [
      /(?:叫|叫做|名叫|称呼|called|named|call me)\s*([\p{L}\p{N}_-]{1,60})/iu,
      /(?:name is)\s*([\p{L}\p{N}_-]{1,60})/iu
    ],
    uses: [
      /(?:使用|用|改用|换用|uses?|use|switch(?:ed)? to)\s*([\p{L}\p{N}_ ./@-]{1,80})/iu
    ],
    default: [
      /(?:默认|defaults? to)\s*([\p{L}\p{N}_ ./@-]{1,80})/iu
    ],
    preference: [
      /(?:喜欢|偏好|希望|习惯|prefer|like|likes|want)\s*([\p{L}\p{N}_ ./@-]{1,100})/iu
    ],
    requirement: [
      /(?:必须|需要|should|must|requires?)\s*([\p{L}\p{N}_ ./@-]{1,120})/iu
    ],
    constraint: [
      /(?:不要|不能|禁止|never|avoid|forbid)\s*([\p{L}\p{N}_ ./@-]{1,120})/iu
    ],
    has: [
      /(?:有|拥有|has|have)\s*([\p{L}\p{N}_ ./@-]{1,100})/iu
    ],
    value: [
      /(?:是|为|改为|变成|is|are|becomes?)\s*([\p{L}\p{N}_ ./@-]{1,100})/iu
    ]
  }
  for (const pattern of patternsByRelation[relation] ?? patternsByRelation.value) {
    const match = text.match(pattern)
    if (match?.[1]) return cleanupFactValue(match[1])
  }

  const subjectIndex = subject && subject !== 'general' ? normalizeForSearch(text).indexOf(normalizeForSearch(subject)) : -1
  if (subjectIndex >= 0) {
    const afterSubject = text.slice(Math.min(text.length, subjectIndex + subject.length)).trim()
    const value = afterSubject.replace(/^(叫|叫做|名叫|称呼|是|为|有|使用|用|默认|需要|必须|不要|called|named|is|are|has|have|uses?|defaults?|requires?|must|should|never)\s*/iu, '')
    if (value) return cleanupFactValue(value)
  }

  return cleanupFactValue(text)
}

function cleanupFactValue(value: string): string {
  return truncate(normalizeMemoryText(value)
    .replace(/^(一?只|一个|个|只|a|an)\s*/iu, '')
    .replace(/(?:了|啦|哦|哈)$/u, '')
    .trim(), 120)
}

export function memoryFactCandidate(text: string): MemoryFactCandidate {
  const content = extractUserMemoryStatement(text)
  if (!content) return { content: null, slot: null, operation: 'noop' }
  return {
    content,
    slot: memoryConflictKey({
      kind: inferKind(content),
      title: content,
      content,
      summary: content,
      tags: inferTags(content)
    }),
    operation: 'update'
  }
}

function extractUserMemoryStatement(text: string): string | null {
  const source = normalizeMemoryText(text)
  if (!source) return null
  if (isMemoryQuestion(source)) return null
  const replacement = extractReplacementMemoryStatement(source)
  if (replacement) return replacement

  const candidates = [
    ...extractByPatterns(source, USER_MEMORY_PATTERNS),
    stripMemoryDirective(source)
  ]

  for (const candidate of candidates) {
    const normalized = normalizeMemoryText(candidate)
    if (isUsefulMemoryCandidate(normalized)) return truncate(normalized, 220)
  }
  return null
}

/** 「更替标记」：句子明确表达「现在改成 X / 从现在起用 X」时才触发规范化压缩 */
const REPLACEMENT_MARKER_RE = /(?:现在|如今|目前|后来|改成|换成|变成|现在改为|现在用|now|currently|from now on)\s*([^。！？.!?\n]{2,180})/iu

function extractReplacementMemoryStatement(text: string): string | null {
  const normalized = normalizeMemoryText(text)
  const currentClause = normalized.match(REPLACEMENT_MARKER_RE)?.[1]
  // 仅当句子确实带更替标记时才做 canonical 压缩：否则强行规范化会丢掉句子里的关键
  // 检索词（如「我喜欢用 pnpm 作为包管理器」→ 只剩「我的使用pnpm」，「包管理器」丢失，
  // 按自然提问再也检索不到）。无标记时返回 null，交回下游模式抽取以保留更多原文。
  if (!currentClause) return null
  return canonicalFactFromClause(normalizeMemoryText(currentClause), normalized)
}

function canonicalFactFromClause(clause: string, fullText = clause): string | null {
  const named = clause.match(/(?:我的|my|our)?\s*([\p{L}\p{N}_-]{1,32})?[^，。！？.!?\n]{0,24}(?:叫|叫做|名叫|称呼|called|named)\s*([\p{L}\p{N}_-]{1,32})/iu)
  if (named?.[2]) {
    if (/^(我|i)$/i.test(normalizeMemoryText(named[1] ?? ''))) {
      return `我叫${normalizeMemoryText(named[2])}`
    }
    const subject = canonicalSubject(named[1], fullText)
    return `${canonicalOwner(fullText)}${subject}叫${normalizeMemoryText(named[2])}`
  }

  const value = clause.match(/(?:是|为|改为|变成|is|are|becomes?)\s*([\p{L}\p{N}_-]{1,60})/iu)
  const subject = extractSubjectHint(clause, fullText)
  if (subject && value?.[1]) return `${canonicalOwner(fullText)}${subject}是${normalizeMemoryText(value[1])}`

  const using = clause.match(/(?:使用|用|改用|换用|uses?|use|switch(?:ed)? to)\s*([\p{L}\p{N}_-]{1,40})/iu)
  if (using?.[1]) {
    const owner = /项目|工作区|project|repo|workspace/i.test(fullText) ? '当前项目' : canonicalOwner(fullText)
    return `${owner}使用${normalizeMemoryText(using[1])}`
  }

  return null
}

function canonicalOwner(text: string): string {
  return /项目|工作区|project|repo|workspace/i.test(text) ? '当前项目' : '我的'
}

function canonicalSubject(raw: string | undefined, context: string): string {
  const hinted = raw || extractSubjectHint(context, context) || '信息'
  return normalizeSubjectAlias(hinted, context)
}

function extractSubjectHint(clause: string, context: string): string | null {
  const owned = context.match(/(?:我的|my|our)\s*([\p{L}\p{N}_-]{1,32})/iu)
  if (owned?.[1]) return owned[1]
  const raised = clause.match(/(?:养了?|有了?|换了?|adopt(?:ed)?|have|has)\s*(?:一?只|一个|个|只|a|an)?\s*([\p{L}\p{N}_-]{1,32})/iu)
  if (raised?.[1]) return raised[1]
  const project = context.match(/(?:项目|工作区|project|repo|workspace)\s*([\p{L}\p{N}_-]{1,32})/iu)
  return project?.[1] ?? null
}

function normalizeSubjectAlias(subject: string, context: string): string {
  const normalized = normalizeForSearch(subject)
  for (const group of SUBJECT_ALIAS_GROUPS) {
    if (group.aliases.some((alias) => normalized.includes(alias) || normalizeForSearch(context).includes(alias))) {
      return group.canonical
    }
  }
  return normalizeMemoryText(subject)
}

function extractByPatterns(text: string, patterns: RegExp[]): string[] {
  const values: string[] = []
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1]) values.push(match[1])
  }
  return values
}

function stripMemoryDirective(text: string): string {
  return text
    .replace(/^(请|麻烦)?(记住|记录|保存|remember|note|save)\s*[:：,，]?\s*/iu, '')
    .replace(/^(更正|纠正|不对|错了|actually|correction|instead)\s*[:：,，]?\s*/iu, '')
    .replace(/^(以后|之后|从现在开始|现在|当前|from now on|now)\s*[:：,，]?\s*/iu, '')
}

function isUsefulMemoryCandidate(value: string): boolean {
  if (value.length < 4 || value.length > 260) return false
  if (isMemoryQuestion(value)) return false
  if (/(请问|能否|可以吗|帮我|怎么|如何|what|how|why|can you|could you)/i.test(value)) return false
  return /我|我的|本项目|当前项目|这个项目|工作区|流程|规则|规范|约定|偏好|喜欢|习惯|不要|必须|默认|使用|叫|是|有|需要|以后|现在|current project|workspace|repo|rule|policy|prefer|preference|like|habit|my|i |i'm|i am|call me|use|must|never|always|default/i.test(value)
}

export function isMemoryQuestion(text: string): boolean {
  const normalized = normalize(text)
  if (/[?？]$|(?:什么|哪|几|多少|吗|呢|谁|怎么|如何|为何|为什么)/i.test(normalized)) return true
  return /^(?:what|which|who|when|where|why|how|did|does|do|is|are|was|were|can|could|should|would)\b/i.test(normalized)
}

export function memoryConflictKey(memory: Pick<AgentMemory, 'kind' | 'title' | 'content' | 'summary' | 'tags'>): string | null {
  const text = normalizeForSearch([
    memory.title,
    memory.content,
    memory.summary,
    memory.tags.join(' ')
  ].join(' '))
  const explicitSlot = explicitMemorySlot(text)
  if (explicitSlot) return explicitSlot

  const intents = detectMemoryIntents(text)
  const topic = memoryTopicKey(text)
  const subject = topic ? memorySubjectKey(text, topic) : ''
  const topicKey = subject ? `${topic}:${subject}` : topic
  if (topic && (memory.kind === 'preference' || memory.kind === 'instruction' || memory.kind === 'workflow')) {
    return `${memory.kind}:${topicKey}`
  }
  if (topic && intents.has('constraint')) return `constraint:${topicKey}`
  if (topic && intents.has('decision')) return `decision:${topicKey}`
  return null
}

export function memorySlotScopeKey(
  slot: string,
  row: { scope: AgentMemory['scope']; workspace_path: string | null }
): string {
  if (/^(personal|profile|preference:name|preference:language|preference:tone|preference:model)/.test(slot)) {
    return 'user'
  }
  if (/^(project|workflow|decision|constraint)/.test(slot)) {
    return `workspace:${row.workspace_path ?? ''}`
  }
  return `${row.scope}:${row.workspace_path ?? ''}`
}

export function explicitMemorySlot(text: string): string | null {
  const relationSlot = genericRelationSlot(text)
  if (relationSlot) return relationSlot
  if (/(我叫|我的名字|叫我|姓名|称呼|my name is|call me|i am called|name|called)/i.test(text)) return 'profile:name'
  if (/(年龄|几岁|多大|今年\s*\d{1,3}\s*岁|my age is|years old|\bi am \d{1,3}\b|\bi'm \d{1,3}\b)/i.test(text)) return 'profile:age'
  if (/(邮箱|email|e-mail)/i.test(text)) return 'profile:email'
  if (/(电话|手机号|phone|mobile)/i.test(text)) return 'profile:phone'
  if (/(地区|所在地|城市|国家|location|city|country)/i.test(text)) return 'profile:location'
  if (/(时区|timezone|time zone)/i.test(text)) return 'profile:timezone'
  if (/(职业|岗位|角色|job|role|title)/i.test(text)) return 'profile:role'
  if (/(语言|language|locale|中文|english|en-us|zh-cn)/i.test(text)) return 'preference:language'
  if (/(语气|口吻|tone|voice)/i.test(text)) return 'preference:tone'
  if (/(模型|model|deepseek|gpt|claude|qwen|gemini)/i.test(text)) return 'preference:model'
  if (/(分支|branch|master|main)/i.test(text)) return 'project:branch'
  if (/(包管理器|package manager|pnpm|npm|yarn|bun)/i.test(text)) return 'project:package-manager'
  if (/(数据库|database|sqlite|postgres|mysql|mongodb)/i.test(text)) return 'project:database'
  return null
}

function genericRelationSlot(text: string): string | null {
  const source = normalizeForSearch(text)
  const cleaned = source
    .replace(/\b(?:previously|formerly|before|current|currently|now|old|new)\b/giu, ' ')
    .replace(/(?:以前|之前|过去|曾经|原来|当前|现在|新的|旧的|后来|后续)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const scoped = cleaned.match(/^(我的|我|my|our|本项目|当前项目|这个项目|工作区|project|repo|repository|workspace)\s*([\p{L}\p{N}_-]{1,40})?\s*(叫|叫做|名叫|称呼|是|为|有|使用|用|默认|需要|必须|不要|喜欢|偏好|希望|习惯|called|named|is|are|has|have|uses?|defaults?|requires?|must|should|never|always|prefer|prefers|like|likes)/iu)
  if (scoped) {
    const owner = scoped[1]
    const subject = normalizeSlotPart(normalizeSubjectAlias(scoped[2] || inferImplicitSubject(owner, scoped[3]), text))
    const relation = normalizeRelation(scoped[3])
    if (!subject || !relation) return null
    return `${slotNamespace(owner)}:${subject}:${relation}`
  }

  const englishPossessive = cleaned.match(/^(?:my|our)\s+([\p{L}\p{N}_-][\p{L}\p{N}\s_-]{0,48}?)\s+(called|named|is|are|has|have|uses?|defaults?|requires?|must|should|never|always|prefer|prefers|like|likes)\b/iu)
  if (englishPossessive) {
    return `personal:${normalizeSlotPart(normalizeSubjectAlias(englishPossessive[1], text))}:${normalizeRelation(englishPossessive[2])}`
  }

  return null
}

function slotNamespace(owner: string): string {
  return /项目|工作区|project|repo|repository|workspace/i.test(owner) ? 'project' : 'personal'
}

function inferImplicitSubject(owner: string, relation: string): string {
  if (/我|my/i.test(owner) && /叫|名叫|称呼|called|named/i.test(relation)) return 'name'
  return 'general'
}

function normalizeSlotPart(value: string): string {
  return normalizeForSearch(value)
    .replace(/\b(?:what|which|who|when|where|why|how)\b/giu, '')
    .replace(/(?:什么|哪|谁|几|多少)/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function normalizeRelation(value: string): string {
  if (/叫|名叫|称呼|called|named/i.test(value)) return 'name'
  if (/喜欢|偏好|希望|习惯|prefer|prefers|like|likes/i.test(value)) return 'preference'
  if (/使用|用|uses?/i.test(value)) return 'uses'
  if (/默认|defaults?/i.test(value)) return 'default'
  if (/需要|必须|requires?|must|should/i.test(value)) return 'requirement'
  if (/不要|never/i.test(value)) return 'constraint'
  if (/有|has|have/i.test(value)) return 'has'
  if (/是|为|is|are/i.test(value)) return 'value'
  return normalizeSlotPart(value)
}

function memoryTopicKey(text: string): string | null {
  if (/(markdown|md|代码块|表格|链接)/i.test(text)) return 'markdown'
  if (/(ui|界面|样式|布局|交互|按钮|弹窗|视觉|style|layout|modal|component|interaction|design)/i.test(text)) return 'ui'
  if (/(git|分支|commit|merge|rebase|branch)/i.test(text)) return 'git'
  if (/(爬虫|检索|web|crawl|crawler|browser|playwright|crawlee|search)/i.test(text)) return 'web'
  if (/(agent|agentscope|mcp|工具|tool|function calling)/i.test(text)) return 'agent'
  if (/(数据库|sqlite|postgres|mysql|schema|migration|database)/i.test(text)) return 'database'
  if (/(代码|typescript|javascript|vue|react|electron|node|code)/i.test(text)) return 'code'
  if (/(测试|lint|build|type-check|test|e2e)/i.test(text)) return 'verification'
  if (/(部署|发布|上线|deploy|release|ship)/i.test(text)) return 'delivery'
  if (/(安全|权限|认证|登录|security|auth|permission|login)/i.test(text)) return 'security'
  if (/(性能|缓存|并发|队列|performance|cache|concurrency|queue)/i.test(text)) return 'performance'
  if (/(流程|步骤|规范|约定|规则|审批|process|workflow|procedure|policy|rule|approval)/i.test(text)) return 'process'
  return null
}

function memorySubjectKey(text: string, topic: string): string {
  const anchors = memoryAnchors(text, topic)
  if (anchors.length) return anchors.join('-').slice(0, 96)
  if (topic === 'process') return ''
  const tokens = searchTokens(text)
    .filter((token) => token.length > 1)
    .filter((token) => !MEMORY_KEY_STOP_WORDS.has(token))
    .filter((token) => token !== topic)
    .slice(0, 5)
  return tokens.join('-').slice(0, 96)
}

function memoryAnchors(text: string, topic: string): string[] {
  const anchors = new Set<string>()
  const compact = text.replace(/\s+/gu, ' ')
  for (const match of compact.matchAll(/[`'"]([^`'"]{2,48})[`'"]/gu)) {
    anchors.add(normalizeForSearch(match[1]).replace(/\s+/g, '-'))
  }
  for (const match of compact.matchAll(/\b[a-z][a-z0-9_-]{2,40}\b/giu)) {
    const value = match[0].toLowerCase()
    if (!MEMORY_KEY_STOP_WORDS.has(value) && value !== topic) anchors.add(value)
  }
  for (const [anchor, pattern] of MEMORY_ANCHOR_PATTERNS) {
    if (pattern.test(text)) anchors.add(anchor)
  }
  return [...anchors].slice(0, 5)
}

const MEMORY_ANCHOR_PATTERNS: Array<[string, RegExp]> = [
  ['release', /(发版|发布|上线|release|deploy|ship)/i],
  ['approval', /(审批|批准|确认|review|approve|approval)/i],
  ['browser', /(浏览器|webview|browser|electron)/i],
  ['crawler', /(爬虫|检索|crawl|crawler|crawlee|playwright|search)/i],
  ['markdown', /(markdown|md|代码块|表格|链接)/i],
  ['git', /(git|分支|commit|merge|rebase|branch)/i],
  ['database', /(数据库|sqlite|postgres|mysql|mongodb|schema|migration)/i],
  ['model', /(模型|deepseek|gpt|claude|qwen|gemini|model)/i],
  ['language', /(语言|中文|英文|english|locale|i18n|language)/i],
  ['tone', /(语气|口吻|表达|tone|voice|style)/i],
  ['ui', /(ui|界面|样式|布局|按钮|弹窗|视觉|component|layout|modal|design)/i],
  ['test', /(测试|验证|lint|build|type-check|e2e|test)/i],
  ['security', /(安全|权限|认证|登录|security|auth|permission|login)/i],
  ['performance', /(性能|缓存|并发|队列|performance|cache|concurrency|queue)/i]
]

const SUBJECT_ALIAS_GROUPS: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: '宠物',
    aliases: ['宠物', '狗狗', '小狗', '狗', '猫猫', '小猫', '猫', 'pet', 'dog', 'cat']
  },
  {
    canonical: '编辑器',
    aliases: ['编辑器', 'ide', 'editor', 'vscode', 'cursor']
  },
  {
    canonical: '包管理器',
    aliases: ['包管理器', 'package-manager', 'pnpm', 'npm', 'yarn', 'bun']
  },
  {
    canonical: '分支',
    aliases: ['分支', 'branch', 'master', 'main']
  }
]

const USER_MEMORY_PATTERNS = [
  /((?:我|我的)[^，。！？\n]{0,40}(?:叫|叫做|名叫|是|为|有|喜欢|偏好|希望|习惯|使用|用|需要|不要|必须|默认)[^，。！？\n]{1,140})/u,
  /((?:本项目|当前项目|这个项目|工作区)[^，。！？\n]{0,80}(?:使用|用|默认|需要|必须|不要|规则|流程|规范|约定|是|为)[^，。！？\n]{1,160})/u,
  /((?:流程|规则|规范|约定|默认|以后|现在|当前)[^。！？\n]{0,160})/u,
  /(\b(?:my|our)\s+[a-z][a-z0-9 _-]{0,48}\s+(?:is|are|called|uses?|should|must|defaults? to)\s+[^.!?\n]{1,140})/iu,
  /(\b(?:i am|i'm|i have|i like|i prefer|call me|remember that|from now on)\s+[^.!?\n]{1,140})/iu,
  /(\b(?:current project|this project|workspace|repo|repository)\s+[^.!?\n]{0,80}\s+(?:uses?|defaults?|should|must|never|always|requires?)\s+[^.!?\n]{1,140})/iu
]
