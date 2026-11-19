import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AgentMemory, AgentMemoryFactValue } from '../../shared/types/personalization.js'
import { detectMemoryIntents, intentWeight } from './memory-rules.js'
import {
  jaccard,
  normalize,
  normalizeForSearch,
  searchTokens,
  similarityFromTokens,
  truncate
} from './memory-text.js'
import {
  buildStructuredFact,
  explicitMemorySlot,
  memoryConflictKey,
  normalizeMemoryForStorage
} from './memory-facts.js'

/**
 * 记忆存储/检索层：DB 行形态与实体互转、FTS 检索、相关性打分、
 * 近重复折叠与写入前决策（mem0 思路的 ADD/REINFORCE）。
 * 除 safeFtsSearch 外均为纯函数；表结构见 db/migrations（agent_memories + agent_memory_fts）。
 */

export interface MemoryRow {
  id: string
  kind: AgentMemory['kind']
  scope: AgentMemory['scope']
  title: string
  content: string
  summary: string
  tags_json: string
  workspace_path: string | null
  project_id: string | null
  session_id: string | null
  source_message_id: string | null
  source_type: AgentMemory['sourceType']
  source_url: string | null
  source_excerpt: string
  confidence: number
  importance: number
  status: AgentMemory['status']
  pinned: number
  created_at: number
  updated_at: number
  last_used_at: number | null
  use_count: number
  expires_at: number | null
  archived_at: number | null
  metadata_json: string
}

export function rowToMemory(row: MemoryRow): AgentMemory {
  const content = normalizeMemoryForStorage(row.content)
  const metadata = normalizeMemoryMetadata(parseJsonObject(row.metadata_json), content, row)
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    content,
    summary: row.summary === row.content ? summarize(content) : row.summary,
    tags: parseJsonArray(row.tags_json),
    workspacePath: row.workspace_path ?? undefined,
    projectId: row.project_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? undefined,
    sourceExcerpt: row.source_excerpt,
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    metadata
  }
}

function normalizeMemoryMetadata(
  metadata: AgentMemory['metadata'],
  content: string,
  row: MemoryRow
): AgentMemory['metadata'] {
  const canonicalKey = metadata?.canonicalKey ?? memoryConflictKey({
    kind: row.kind,
    title: row.title,
    content,
    summary: row.summary,
    tags: parseJsonArray(row.tags_json)
  }) ?? undefined
  return {
    ...metadata,
    canonicalKey,
    lifecycle: metadata?.lifecycle ?? (row.status === 'active' ? 'current' : 'historical'),
    structuredFact: metadata?.structuredFact ?? buildStructuredFact(content, canonicalKey, row.created_at, row.archived_at ?? undefined)
  }
}

export function factValueFromRow(row: MemoryRow, conflictKey: string, validTo: number): AgentMemoryFactValue {
  const fact = buildStructuredFact(row.content, conflictKey, row.created_at, validTo)
  return {
    value: fact?.value ?? row.content,
    memoryId: row.id,
    validFrom: row.created_at,
    validTo,
    evidence: truncate(row.content, 300)
  }
}

export function compactFactValues(values: AgentMemoryFactValue[]): AgentMemoryFactValue[] {
  const seen = new Set<string>()
  const result: AgentMemoryFactValue[] = []
  for (const value of values) {
    const key = `${value.value}:${value.memoryId ?? ''}`
    if (!value.value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result.slice(-12)
}

export function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function parseJsonObject(raw: string): AgentMemory['metadata'] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as AgentMemory['metadata']
      : {}
  } catch {
    return {}
  }
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => normalize(tag).toLowerCase()).filter(Boolean))].slice(0, 12)
}

export function summarize(content: string): string {
  return truncate(content, 80)
}

export function hashMemory(content: string, scope: string, workspacePath?: string): string {
  return createHash('sha256')
    .update(`${scope}\n${workspacePath ?? ''}\n${normalize(content).toLowerCase()}`)
    .digest('hex')
}

export function ftsQuery(query?: string): string {
  const tokens = searchTokens(query ?? '')
    .filter((token) => token.length > 1)
    .slice(0, 8)
  return tokens.length ? tokens.map((token) => `"${token}"*`).join(' OR ') : ''
}

export function safeFtsSearch(
  db: Database.Database,
  where: string[],
  params: Record<string, unknown>
): MemoryRow[] {
  try {
    return db.prepare(`
      SELECT m.*
      FROM agent_memory_fts f
      JOIN agent_memories m ON m.id = f.memory_id
      WHERE agent_memory_fts MATCH @query
        AND ${where.join(' AND ')}
      ORDER BY (m.status = 'active') DESC, m.pinned DESC, bm25(agent_memory_fts), m.importance DESC, m.updated_at DESC
      LIMIT @limit
    `).all(params) as MemoryRow[]
  } catch {
    return []
  }
}

export function rankMemoryRows(rows: MemoryRow[], query: string, now: number = Date.now()): MemoryRow[] {
  const normalizedQuery = normalizeForSearch(query)
  const tokens = searchTokens(query)
  return rows
    .map((row) => ({ row, score: scoreMemory(row, normalizedQuery, tokens, now) }))
    .filter((item) => item.score > 0)
    .sort((a, b) =>
      Number(b.row.status === 'active') - Number(a.row.status === 'active') ||
      b.score - a.score ||
      b.row.importance - a.row.importance ||
      b.row.updated_at - a.row.updated_at
    )
    .map((item) => item.row)
}

/** recency 半衰期：7 天。frequency 饱和点：约 20 次命中。 */
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000
const FREQUENCY_SATURATION = Math.log1p(20)

export interface ReinforcementInput {
  /** 最近一次被检索命中的时间戳；从未命中为 null */
  lastUsedAt: number | null
  /** 累计被检索命中次数 */
  useCount: number
  now: number
}

/**
 * 记忆强化信号（mem0 / Letta 的核心思路：被频繁且最近使用的记忆更可能相关）。
 * 返回 [0, 1]：
 * - recency：距上次使用的指数衰减，半衰期 7 天（今天用过≈1，一周前≈0.5，从未用=0）。
 * - frequency：命中次数的对数饱和（避免高频记忆无限霸榜），约 20 次趋近 1。
 * 二者 6:4 加权。该值仅作为语义相关性之上的**次要**提升，绝不单独让无关记忆浮现。
 */
export function reinforcementScore(input: ReinforcementInput): number {
  const recency = input.lastUsedAt !== null
    ? Math.pow(0.5, Math.max(0, input.now - input.lastUsedAt) / RECENCY_HALF_LIFE_MS)
    : 0
  const frequency = Math.min(1, Math.log1p(Math.max(0, input.useCount)) / FREQUENCY_SATURATION)
  return 0.6 * recency + 0.4 * frequency
}

export interface SalienceInput {
  importance: number
  confidence: number
  lastUsedAt: number | null
  useCount: number
  createdAt: number
  now: number
}

/**
 * 记忆综合价值分（遗忘淘汰用）：重要度 × 置信度 × 强化。
 * 超容量时淘汰 salience 最低者——让「低重要度但常用」的记忆存活于
 * 「高重要度但从不用」的记忆之上，符合主流 agent 的使用驱动记忆保留。
 * 从未使用的记忆用创建新鲜度兜底，避免刚建立就被判低价值淘汰。
 */
export function memorySalience(input: SalienceInput): number {
  const reinforcement = input.lastUsedAt !== null
    ? reinforcementScore({ lastUsedAt: input.lastUsedAt, useCount: input.useCount, now: input.now })
    : reinforcementScore({ lastUsedAt: input.createdAt, useCount: 0, now: input.now })
  return input.importance * (0.5 + 0.5 * input.confidence) * (0.3 + reinforcement)
}

/** 近重复阈值：仅折叠“同义改写”，冲突事实（值不同，相似度更低）不会被误删 */
export const NEAR_DUPLICATE_SIMILARITY = 0.7

export function dedupeMemories(memories: AgentMemory[]): AgentMemory[] {
  const seenIds = new Set<string>()
  const kept: Array<{ status: AgentMemory['status']; tokens: Set<string> }> = []
  const result: AgentMemory[] = []
  for (const memory of memories) {
    if (seenIds.has(memory.id)) continue
    seenIds.add(memory.id)
    const tokens = new Set(searchTokens(memory.content))
    // 仅在「同状态」记忆间做语义去重：避免把“历史”记忆误判为“当前”记忆的重复而丢弃。
    // 入参已按相关性排序，保留先出现者即保留更相关者。
    const duplicate = kept.some(
      (entry) => entry.status === memory.status
        && similarityFromTokens(entry.tokens, tokens) >= NEAR_DUPLICATE_SIMILARITY
    )
    if (duplicate) continue
    kept.push({ status: memory.status, tokens })
    result.push(memory)
  }
  return result
}

export interface MemoryWriteCandidateRef {
  id: string
  content: string
  slot: string | null
}

export type MemoryWriteDecision =
  | { op: 'add' }
  | { op: 'reinforce'; targetId: string; similarity: number }

/**
 * mem0 的「写入前决策」抽象为纯函数（无 DB 依赖，便于严谨单测）：
 * 把新事实与同范围已有事实比对，决定 ADD（新增）或 REINFORCE（语义近重复→复用已有）。
 * 只填补 slot 体系覆盖不到的缺口——当不存在同 slot 现有项、却存在语义近重复（≥ 阈值）时判为复用，
 * 避免“同义改写”反复入库造成存储冗余；双方 slot 不同（不同主题/关系）一律交回 slot 逻辑，绝不跨主题误并。
 */
export function decideMemoryWrite(
  candidate: { content: string; slot: string | null },
  existing: MemoryWriteCandidateRef[],
  threshold = NEAR_DUPLICATE_SIMILARITY
): MemoryWriteDecision {
  const candidateTokens = new Set(searchTokens(candidate.content))
  if (!candidateTokens.size) return { op: 'add' }

  let best: { id: string; similarity: number } | null = null
  for (const item of existing) {
    // 双方都有 slot 且不同 → 不同主题/关系，留给 slot 逻辑处理，不在此并入
    if (candidate.slot && item.slot && item.slot !== candidate.slot) continue
    const similarity = similarityFromTokens(candidateTokens, new Set(searchTokens(item.content)))
    if (!best || similarity > best.similarity) best = { id: item.id, similarity }
  }
  return best && best.similarity >= threshold
    ? { op: 'reinforce', targetId: best.id, similarity: best.similarity }
    : { op: 'add' }
}

/** 强化提升的权重：约等于一次弱意图匹配，远低于强语义重叠（jaccard*20 等），故只调序不越界 */
const REINFORCEMENT_WEIGHT = 12

function scoreMemory(row: MemoryRow, query: string, tokens: string[], now: number): number {
  const haystack = normalizeForSearch([
    row.title,
    row.content,
    row.summary,
    row.tags_json,
    row.source_excerpt
  ].join(' '))
  let evidence = 0

  for (const token of tokens) {
    if (haystack.includes(token)) evidence += token.length >= 3 ? 5 : 2
  }
  const haystackTokens = searchTokens(haystack)
  evidence += jaccard(haystackTokens, tokens) * 20
  // 集合余弦：对长度差异更稳健的语义信号，与去重同口径，补足 jaccard 在长短文本上的偏差
  evidence += similarityFromTokens(new Set(haystackTokens), new Set(tokens)) * 16

  const queryIntents = detectMemoryIntents(query)
  const memoryIntents = detectMemoryIntents(haystack)
  for (const intent of queryIntents) {
    if (memoryIntents.has(intent)) evidence += intentWeight(intent)
  }
  if (query.length > 0 && haystack.includes(query)) evidence += 20
  if (sameMemorySlot(query, haystack)) evidence += 18
  // 强化只作用于已有语义证据的记忆：evidence<=0（与查询无关）直接淘汰，
  // 绝不因「最近用过」而让不相关记忆浮现。
  if (evidence <= 0) return 0

  const reinforcement = reinforcementScore({ lastUsedAt: row.last_used_at, useCount: row.use_count, now })
  return evidence
    + reinforcement * REINFORCEMENT_WEIGHT
    + (row.pinned ? 8 : 0)
    + row.importance * 1.2
    + row.confidence * 3
}

function sameMemorySlot(left: string, right: string): boolean {
  const leftSlot = explicitMemorySlot(left)
  if (!leftSlot) return false
  return explicitMemorySlot(right) === leftSlot
}
