import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { DatabaseService } from '../db/database.service.js'
import {
  MAX_AGENT_MEMORIES,
  type AgentMemory,
  type MemoryCaptureRequest,
  type MemoryCreateInput,
  type MemoryListOptions,
  type PersonalizationSettings
} from '../../shared/types/personalization.js'
import { isMemoryHistoryQuery } from './memory-rules.js'
import { clampInt, clampNumber, memorySimilarity, normalize, truncate } from './memory-text.js'
import {
  buildMemoryContent,
  buildStructuredFact,
  inferImportance,
  inferKind,
  inferTags,
  memoryConflictKey,
  memoryFactCandidate,
  memoryQuestionKey,
  memorySlotScopeKey,
  memoryUpdateKey,
  repairGeneratedEchoMemory,
  shouldCapture,
  type MemoryFactCandidate
} from './memory-facts.js'
import {
  compactFactValues,
  decideMemoryWrite,
  dedupeMemories,
  factValueFromRow,
  ftsQuery,
  hashMemory,
  memorySalience,
  normalizeTags,
  parseJsonObject,
  rankMemoryRows,
  rowToMemory,
  safeFtsSearch,
  summarize,
  type MemoryRow,
  type MemoryWriteCandidateRef
} from './memory-retrieval.js'

/**
 * 记忆服务（DB 侧编排）：生命周期（创建/强化/归档/删除）、slot 冲突交替、
 * 检索入口与一次性迁移修复。
 * 纯逻辑按层拆在同目录：memory-text（分词/相似度）→ memory-facts（事实抽取/槽位）
 * → memory-retrieval（行映射/FTS/打分/写入决策），本文件只保留有状态的 SQL 编排。
 *
 * agent_memory_events 是只写审计表（全仓无读取方，仅生命周期事件有留存价值）。
 * 上限行数，超出时在 trim 里裁掉最旧记录，避免无限增长拖慢记忆链路。
 */
const MAX_MEMORY_EVENTS = 5000

export class MemoryService {
  private legacyImported = false
  private repairedGeneratedEchoes = false
  private normalizedActiveSlots = false

  private get db(): Database.Database {
    return DatabaseService.getInstance().db
  }

  private get legacyStorePath(): string {
    return join(app.getPath('userData'), 'agent-memories.json')
  }

  async list(options: MemoryListOptions = {}): Promise<AgentMemory[]> {
    await this.importLegacyIfNeeded()
    this.repairGeneratedEchoesIfNeeded()
    this.normalizeActiveSlotsIfNeeded()
    const limit = clampInt(options.limit, 1, 200, 50)
    const query = ftsQuery(options.query)
    // 只装配查询实际用到的命名参数（避免依赖驱动对多余参数的宽容；node:sqlite 会严格拒绝）
    const params: Record<string, unknown> = { minConfidence: options.minConfidence ?? 0 }
    const where: string[] = []

    if (!options.includeArchived) {
      where.push(`m.status = 'active'`)
    } else {
      where.push(`m.status IN ('active', 'archived')`)
    }

    if (options.workspacePath) {
      params.workspacePath = options.workspacePath
      where.push(options.includeGlobal === false
        ? `m.workspace_path = @workspacePath`
        : `(m.scope = 'global' OR m.workspace_path = @workspacePath)`)
    }
    where.push(`m.confidence >= @minConfidence`)
    where.push(`(m.expires_at IS NULL OR m.expires_at > ${Date.now()})`)

    if (query) {
      // 召回与排序分离（主流 agent 记忆检索的通用架构）：
      // FTS（命中）或候选扫描（未命中）先做「召回」拿一批候选，再统一交给
      // rankMemoryRows 做「排序」——语义相关性 + 记忆强化(recency/frequency)。
      // 早期版本 FTS 命中即按 bm25 直接返回，绕过了强化排序，此处收敛为单一口径。
      const recall = Math.max(limit * 5, 50)
      const ftsRows = safeFtsSearch(this.db, where, { ...params, query, limit: recall })
      const pool = ftsRows.length > 0
        ? ftsRows
        : this.db.prepare(`
            SELECT m.*
            FROM agent_memories m
            WHERE ${where.join(' AND ')}
            ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC
            LIMIT 200
          `).all(params) as MemoryRow[]
      const ranked = rankMemoryRows(pool, String(options.query ?? ''))
      // 分词口径差异极端情况下 rankMemoryRows 可能把 FTS 命中项全判 0；
      // 此时退回召回原序，避免「明明索引命中却返回空」。
      const ordered = ranked.length > 0 ? ranked : pool
      return ordered.slice(0, limit).map(rowToMemory)
    }

    const rows = this.db.prepare(`
      SELECT m.*
      FROM agent_memories m
      WHERE ${where.join(' AND ')}
      ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC
      LIMIT @limit
    `).all({ ...params, limit }) as MemoryRow[]
    return rows.map(rowToMemory)
  }

  async count(): Promise<number> {
    await this.importLegacyIfNeeded()
    this.repairGeneratedEchoesIfNeeded()
    this.normalizeActiveSlotsIfNeeded()
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM agent_memories WHERE status = 'active'`).get() as { count: number }).count
  }

  async reset(): Promise<void> {
    await this.importLegacyIfNeeded()
    DatabaseService.getInstance().transaction(() => {
      this.db.prepare(`DELETE FROM agent_memory_events`).run()
      this.db.prepare(`DELETE FROM agent_memory_fts`).run()
      this.db.prepare(`DELETE FROM agent_memories`).run()
    })
  }

  async create(input: MemoryCreateInput): Promise<AgentMemory> {
    await this.importLegacyIfNeeded()
    this.repairGeneratedEchoesIfNeeded()
    this.normalizeActiveSlotsIfNeeded()
    const now = Date.now()
    const candidate = memoryFactCandidate(input.content)
    const content = candidate.content ?? normalize(input.content)
    if (!content) throw new Error('记忆内容不能为空')
    const summary = normalize(input.summary ?? summarize(content))
    const memory: AgentMemory = {
      id: randomUUID(),
      kind: input.kind ?? inferKind(content),
      scope: input.scope ?? (input.workspacePath ? 'workspace' : 'global'),
      title: normalize(input.title ?? summary).slice(0, 120),
      content,
      summary,
      tags: normalizeTags(input.tags ?? inferTags(content)),
      workspacePath: input.workspacePath || undefined,
      projectId: input.projectId || undefined,
      sessionId: input.sessionId || undefined,
      sourceMessageId: input.sourceMessageId || undefined,
      sourceType: input.sourceType ?? 'manual',
      sourceUrl: input.sourceUrl || undefined,
      sourceExcerpt: normalize(input.sourceExcerpt ?? '').slice(0, 800),
      confidence: clampNumber(input.confidence, 0, 1, 0.72),
      importance: clampInt(input.importance, 1, 5, 3),
      status: 'active',
      pinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
      metadata: {
        canonicalKey: candidate.slot ?? undefined,
        lifecycle: 'current',
        supersedesIds: [],
        structuredFact: buildStructuredFact(content, candidate.slot ?? undefined, now)
      }
    }
    const contentHash = hashMemory(memory.content, memory.scope, memory.workspacePath)

    const existing = this.db
      .prepare(`SELECT * FROM agent_memories WHERE content_hash = ?`)
      .get(contentHash) as MemoryRow | undefined
    if (existing) {
      const updated = this.reviveOrReinforce(existing.id, memory)
      if (updated) return updated
    }

    // mem0 风格的「入库前语义去重」：内容哈希不同、但与同范围已有事实语义近重复（同义改写）时，
    // 复用并强化已有记忆而非新增，从源头抑制存储冗余（slot 冲突仍交由下方 slot 逻辑 supersede）。
    const semanticDuplicateId = this.findActiveSemanticDuplicate(memory, candidate.slot ?? null)
    if (semanticDuplicateId) {
      const reinforced = this.reviveOrReinforce(semanticDuplicateId, memory)
      if (reinforced) return reinforced
    }

    let inserted = false
    DatabaseService.getInstance().transaction(() => {
      this.applyMemoryOperation(memory, candidate)
      inserted = this.insert(memory)
      if (inserted) {
        this.recordEvent(memory.id, 'created', memory.sessionId, memory.sourceMessageId)
      }
    })
    if (!inserted) {
      const duplicate = this.db
        .prepare(`SELECT * FROM agent_memories WHERE content_hash = ?`)
        .get(contentHash) as MemoryRow | undefined
      if (duplicate) {
        const updated = this.reviveOrReinforce(duplicate.id, memory)
        if (updated) return updated
      }
      throw new Error('记忆写入失败：重复内容未能复用')
    }
    await this.trim()
    this.normalizeActiveSlots()
    return memory
  }

  async maybeCapture(
    request: MemoryCaptureRequest,
    settings: PersonalizationSettings
  ): Promise<AgentMemory | null> {
    if (!settings.memoryEnabled) return null
    if (settings.memoryAutoCapture === 'off') return null
    if (settings.skipToolAssistedMemory && request.usedTools) return null

    const userMessage = normalize(request.userMessage)
    const assistantMessage = normalize(request.assistantMessage)
    if (!userMessage || !assistantMessage) return null
    if (!shouldCapture(userMessage, assistantMessage, settings.memoryAutoCapture)) return null
    const workspaceScoped = settings.memoryDefaultScope === 'workspace' && Boolean(request.workspacePath)
    const retentionMs = settings.memoryRetentionDays > 0
      ? settings.memoryRetentionDays * 24 * 60 * 60 * 1000
      : 0

    return this.create({
      kind: inferKind(`${userMessage}\n${assistantMessage}`),
      scope: workspaceScoped ? 'workspace' : 'global',
      workspacePath: workspaceScoped ? request.workspacePath : undefined,
      sessionId: request.sessionId,
      sourceType: 'chat',
      sourceExcerpt: truncate(`用户: ${userMessage}\n助手: ${assistantMessage}`, 800),
      content: buildMemoryContent(userMessage, assistantMessage),
      confidence: request.usedTools ? 0.64 : 0.72,
      importance: inferImportance(userMessage, assistantMessage),
      expiresAt: retentionMs ? Date.now() + retentionMs : undefined
    })
  }

  async retrieveForPrompt(options: {
    query: string
    workspacePath?: string
    includeGlobal?: boolean
    minConfidence?: number
    limit?: number
  }): Promise<AgentMemory[]> {
    const includeHistory = isMemoryHistoryQuery(options.query)
    const updateKey = includeHistory ? null : memoryUpdateKey(options.query)
    const questionKey = memoryQuestionKey(options.query)
    const memories = await this.list({
      query: options.query,
      workspacePath: options.workspacePath,
      includeGlobal: options.includeGlobal ?? true,
      includeArchived: includeHistory,
      minConfidence: options.minConfidence ?? 0,
      limit: options.limit ?? 8
    })
    const historyMemories = includeHistory && questionKey
      ? await this.list({
        workspacePath: options.workspacePath,
        includeGlobal: options.includeGlobal ?? true,
        includeArchived: true,
        minConfidence: options.minConfidence ?? 0,
        limit: 200
      })
      : []
    const merged = dedupeMemories([...memories, ...historyMemories])
    const focusKey = updateKey ?? questionKey
    // slot 聚焦：更新/提问命中某个具体槽位时，优先只回该槽位的记忆（当前值 + 历史值）。
    // 但槽位推导在「陈述句」与「疑问句」间并不总对称（如提问「用什么包管理器」得到
    // project:package-manager，而事实「我用 pnpm」落到 personal:包管理器:uses）——
    // 若严格过滤后为空，则优雅降级为已按相关性排序的候选，避免明明存了却答不上来。
    let scopedMemories = merged
    if (focusKey) {
      const focused = merged.filter((memory) => memoryConflictKey(memory) === focusKey)
      scopedMemories = focused.length ? focused : merged
    }
    this.markUsedBatch(scopedMemories.map((memory) => memory.id))
    return scopedMemories
  }

  isMemoryUpdateMessage(message: string): boolean {
    return Boolean(memoryUpdateKey(message))
  }

  async archive(id: string): Promise<AgentMemory | null> {
    await this.importLegacyIfNeeded()
    const now = Date.now()
    const result = this.db.prepare(`
      UPDATE agent_memories
      SET status = 'archived', archived_at = ?, updated_at = ?
      WHERE id = ? AND status != 'deleted'
    `).run(now, now, id)
    if (result.changes === 0) return null
    this.recordEvent(id, 'archived')
    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    await this.importLegacyIfNeeded()
    const now = Date.now()
    const result = this.db.prepare(`
      UPDATE agent_memories
      SET status = 'deleted', archived_at = ?, updated_at = ?
      WHERE id = ? AND status != 'deleted'
    `).run(now, now, id)
    if (result.changes > 0) this.recordEvent(id, 'deleted')
    return result.changes > 0
  }

  formatForPrompt(memories: AgentMemory[]): string {
    if (!memories.length) return ''
    const hasHistory = memories.some((memory) => memory.status === 'archived')
    const rules = hasHistory
      ? [
          '记忆使用规则：',
          '- “当前”记忆代表默认事实和当前执行方式，应优先采用。',
          '- “历史”记忆只用于回答过去、演进、变更原因、曾经做法等问题，不得覆盖当前记忆。',
          '- 记忆是隐式上下文；除非用户询问或需要纠错，不要主动枚举无关记忆。'
        ].join('\n')
      : '记忆使用规则：优先采用当前记忆；记忆是隐式上下文，不要在用户没问时主动枚举无关记忆。'
    const items = memories
      .slice()
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.importance - a.importance)
      .map((memory) => {
        const scope = memory.scope === 'global' ? '全局' : memory.scope === 'workspace' ? '工作区' : '会话'
        const status = memory.status === 'active' ? '当前' : memory.status === 'archived' ? '历史' : '已删除'
        const fact = memory.metadata?.structuredFact
        const structured = fact
          ? ` | 结构化事实: ${fact.namespace}.${fact.subject}.${fact.relation} = ${fact.value}`
          : ''
        return `- [${status}/${scope}/${memory.kind}/重要度${memory.importance}] ${memory.content}${structured}`
      })
      .join('\n')
    return `${rules}\n${items}`
  }

  private get(id: string): AgentMemory | null {
    const row = this.db.prepare(`SELECT * FROM agent_memories WHERE id = ?`).get(id) as MemoryRow | undefined
    return row ? rowToMemory(row) : null
  }

  /** 取同范围（同 scope / 工作区）的活跃记忆作为候选，交给纯函数 decideMemoryWrite 判定是否语义近重复 */
  private findActiveSemanticDuplicate(memory: AgentMemory, slot: string | null): string | null {
    const workspaceScoped = memory.scope === 'workspace' && Boolean(memory.workspacePath)
    // 只传查询实际引用的命名参数：不依赖驱动对多余参数的宽容处理（node:sqlite 严格拒绝）
    const scopeClause = workspaceScoped
      ? `scope = 'workspace' AND workspace_path = @workspacePath`
      : `scope = @scope`
    const params = workspaceScoped
      ? { workspacePath: memory.workspacePath }
      : { scope: memory.scope }
    const rows = this.db.prepare(`
      SELECT id, content, metadata_json
      FROM agent_memories
      WHERE status = 'active' AND ${scopeClause}
      ORDER BY importance DESC, updated_at DESC
      LIMIT 80
    `).all(params) as Array<Pick<MemoryRow, 'id' | 'content' | 'metadata_json'>>

    const candidates: MemoryWriteCandidateRef[] = rows.map((row) => ({
      id: row.id,
      content: row.content,
      slot: parseJsonObject(row.metadata_json)?.canonicalKey ?? null
    }))
    const decision = decideMemoryWrite({ content: memory.content, slot }, candidates)
    return decision.op === 'reinforce' ? decision.targetId : null
  }

  private reinforce(id: string): AgentMemory | null {
    const now = Date.now()
    this.db.prepare(`
      UPDATE agent_memories
      SET importance = MIN(5, importance + 1), updated_at = ?
      WHERE id = ?
    `).run(now, id)
    this.recordEvent(id, 'reinforced')
    return this.get(id)
  }

  private reviveOrReinforce(id: string, memory: AgentMemory): AgentMemory | null {
    const row = this.db.prepare(`SELECT * FROM agent_memories WHERE id = ?`).get(id) as MemoryRow | undefined
    if (!row) return null
    if (row.status === 'active') return this.reinforce(id)

    const now = Date.now()
    this.db.prepare(`
      UPDATE agent_memories
      SET status = 'active',
          kind = ?,
          title = ?,
          summary = ?,
          tags_json = ?,
          source_type = ?,
          source_excerpt = ?,
          confidence = MAX(confidence, ?),
          importance = MAX(importance, ?),
          pinned = MAX(pinned, ?),
          archived_at = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(
      memory.kind,
      memory.title,
      memory.summary,
      JSON.stringify(memory.tags),
      memory.sourceType,
      memory.sourceExcerpt,
      memory.confidence,
      memory.importance,
      memory.pinned ? 1 : 0,
      now,
      id
    )
    this.recordEvent(id, 'updated', memory.sessionId, memory.sourceMessageId, `revived from ${row.status}`)
    return this.get(id)
  }

  /**
   * 批量标记记忆被检索命中：更新 last_used_at + 递增 use_count（记忆强化）。
   *
   * last_used_at + use_count 共同驱动检索打分的 recency/frequency 提升与遗忘淘汰的
   * 综合价值分（mem0/Letta 思路）。合并为单条 IN 更新，避免关键路径上逐条同步写
   * （历史查询可命中数百条）；不再写 'retrieved' 事件（全仓无读取方，纯写放大）。
   */
  private markUsedBatch(ids: string[]): void {
    if (!ids.length) return
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(
      `UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1 WHERE id IN (${placeholders})`
    ).run(Date.now(), ...ids)
  }

  private insert(memory: AgentMemory): boolean {
    // 显式装配 bind 对象，只放 SQL 引用的命名参数：不 `...memory` 展开，
    // 避免把 tags 数组 / metadata 对象等非绑定值传给驱动（better-sqlite3 静默忽略，
    // node:sqlite 直接报错），也杜绝日后新增字段意外泄入。
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO agent_memories (
        id, kind, scope, title, content, summary, tags_json, entities_json,
        workspace_path, project_id, session_id, source_message_id,
        source_type, source_url, source_excerpt, confidence, importance,
        status, pinned, content_hash, metadata_json, created_at, updated_at, expires_at
      ) VALUES (
        @id, @kind, @scope, @title, @content, @summary, @tagsJson, '[]',
        @workspacePath, @projectId, @sessionId, @sourceMessageId,
        @sourceType, @sourceUrl, @sourceExcerpt, @confidence, @importance,
        @status, @pinned, @contentHash, @metadataJson, @createdAt, @updatedAt, @expiresAt
      )
    `).run({
      id: memory.id,
      kind: memory.kind,
      scope: memory.scope,
      title: memory.title,
      content: memory.content,
      summary: memory.summary,
      tagsJson: JSON.stringify(memory.tags),
      pinned: memory.pinned ? 1 : 0,
      contentHash: hashMemory(memory.content, memory.scope, memory.workspacePath),
      metadataJson: JSON.stringify(memory.metadata ?? {}),
      sourceType: memory.sourceType,
      sourceExcerpt: memory.sourceExcerpt,
      confidence: memory.confidence,
      importance: memory.importance,
      status: memory.status,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      workspacePath: memory.workspacePath ?? null,
      projectId: memory.projectId ?? null,
      sessionId: memory.sessionId ?? null,
      sourceMessageId: memory.sourceMessageId ?? null,
      sourceUrl: memory.sourceUrl ?? null,
      expiresAt: memory.expiresAt ?? null
    })
    return result.changes > 0
  }

  private repairGeneratedEchoesIfNeeded(): void {
    if (this.repairedGeneratedEchoes) return
    this.repairedGeneratedEchoes = true

    const rows = this.db.prepare(`
      SELECT *
      FROM agent_memories
      WHERE status = 'active'
        AND content LIKE '用户曾询问「%处理结论：%'
      LIMIT 200
    `).all() as MemoryRow[]
    if (!rows.length) return

    const now = Date.now()
    DatabaseService.getInstance().transaction(() => {
      for (const row of rows) {
        const repaired = repairGeneratedEchoMemory(row.content)
        if (!repaired) continue

        const nextHash = hashMemory(repaired, row.scope, row.workspace_path ?? undefined)
        const duplicate = this.db.prepare(`
          SELECT *
          FROM agent_memories
          WHERE content_hash = ? AND id != ?
        `).get(nextHash, row.id) as MemoryRow | undefined

        if (duplicate) {
          this.db.prepare(`
            UPDATE agent_memories
            SET status = 'archived', archived_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active'
          `).run(now, now, row.id)
          this.recordEvent(row.id, 'archived', row.session_id ?? undefined, row.source_message_id ?? undefined, 'repaired duplicate generated echo')
          if (duplicate.status === 'deleted') {
            this.db.prepare(`
              UPDATE agent_memories
              SET status = 'active', archived_at = NULL, updated_at = ?
              WHERE id = ?
            `).run(now, duplicate.id)
            this.recordEvent(duplicate.id, 'updated', duplicate.session_id ?? undefined, duplicate.source_message_id ?? undefined, 'revived duplicate generated echo')
          }
          continue
        }

        const summary = summarize(repaired)
        try {
          this.db.prepare(`
            UPDATE agent_memories
            SET content = ?, summary = ?, title = ?, tags_json = ?, content_hash = ?, updated_at = ?
            WHERE id = ?
          `).run(
            repaired,
            summary,
            summary.slice(0, 120),
            JSON.stringify(normalizeTags(inferTags(repaired))),
            nextHash,
            now,
            row.id
          )
          this.recordEvent(row.id, 'updated', row.session_id ?? undefined, row.source_message_id ?? undefined, 'repaired generated echo')
        } catch (error) {
          if (!String(error).includes('UNIQUE constraint failed')) throw error
          this.db.prepare(`
            UPDATE agent_memories
            SET status = 'archived', archived_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active'
          `).run(now, now, row.id)
          this.recordEvent(row.id, 'archived', row.session_id ?? undefined, row.source_message_id ?? undefined, 'repaired generated echo collided with existing content hash')
        }
      }
    })
  }

  private normalizeActiveSlotsIfNeeded(): void {
    if (this.normalizedActiveSlots) return
    this.normalizedActiveSlots = true
    this.normalizeActiveSlots()
  }

  private normalizeActiveSlots(): void {
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_memories
      WHERE status = 'active'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1000
    `).all() as MemoryRow[]
    if (!rows.length) return

    const groups = new Map<string, MemoryRow[]>()
    for (const row of rows) {
      const slot = memoryConflictKey(rowToMemory(row))
      if (!slot) continue
      const scopeKey = `${memorySlotScopeKey(slot, row)}:${slot}`
      const group = groups.get(scopeKey)
      if (group) group.push(row)
      else groups.set(scopeKey, [row])
    }

    const now = Date.now()
    DatabaseService.getInstance().transaction(() => {
      for (const group of groups.values()) {
        const pinned = group.filter((row) => row.pinned === 1)
        const candidates = pinned.length ? group.filter((row) => row.pinned === 0) : group.slice(1)
        for (const row of candidates) {
          const result = this.db.prepare(`
            UPDATE agent_memories
            SET status = 'archived', archived_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active'
          `).run(now, now, row.id)
          if (result.changes > 0) {
            this.recordEvent(row.id, 'archived', row.session_id ?? undefined, row.source_message_id ?? undefined, 'normalized duplicate active memory slot')
          }
        }
      }
    })
  }

  private applyMemoryOperation(memory: AgentMemory, candidate: MemoryFactCandidate): void {
    if (candidate.operation === 'noop') return
    if (!candidate.slot) {
      this.archiveConflicts(memory)
      return
    }
    this.archiveSlotConflicts(memory, candidate.slot)
  }

  private archiveConflicts(memory: AgentMemory): void {
    const conflictKey = memoryConflictKey(memory)
    if (!conflictKey) return
    this.archiveSlotConflicts(memory, conflictKey)
  }

  private archiveSlotConflicts(memory: AgentMemory, conflictKey: string): void {
    // 只传查询实际引用的命名参数（不依赖驱动对多余参数的宽容）
    const scopeFilter = memory.workspacePath
      ? `(scope = 'global' OR workspace_path = @workspacePath)`
      : `scope = @scope`
    const params = memory.workspacePath
      ? { workspacePath: memory.workspacePath }
      : { scope: memory.scope }
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_memories
      WHERE status = 'active'
        AND pinned = 0
        AND ${scopeFilter}
      ORDER BY updated_at DESC
      LIMIT 300
    `).all(params) as MemoryRow[]

    const now = Date.now()
    for (const row of rows) {
      if (normalize(row.content).toLowerCase() === normalize(memory.content).toLowerCase()) continue
      if (memoryConflictKey(rowToMemory(row)) !== conflictKey) continue

      const result = this.db.prepare(`
        UPDATE agent_memories
        SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(now, now, row.id)
      if (result.changes > 0) {
        this.writeDeprecatedLineage(row, memory, conflictKey, now)
        this.recordEvent(
          row.id,
          'archived',
          memory.sessionId,
          memory.sourceMessageId,
          `superseded by ${memory.id} (${conflictKey})`
        )
      }
    }
  }

  private writeDeprecatedLineage(row: MemoryRow, successor: AgentMemory, conflictKey: string, now: number): void {
    const metadata = {
      ...parseJsonObject(row.metadata_json),
      canonicalKey: conflictKey,
      lifecycle: 'deprecated' as const,
      supersededById: successor.id,
      deprecatedAt: now,
      lineageReason: `superseded by newer memory in slot ${conflictKey}`,
      structuredFact: buildStructuredFact(row.content, conflictKey, row.created_at, now)
    }
    this.db.prepare(`
      UPDATE agent_memories
      SET metadata_json = ?
      WHERE id = ?
    `).run(JSON.stringify(metadata), row.id)

    successor.metadata = {
      ...(successor.metadata ?? {}),
      canonicalKey: conflictKey,
      lifecycle: 'current',
      structuredFact: successor.metadata?.structuredFact ?? buildStructuredFact(successor.content, conflictKey, now),
      previousValues: compactFactValues([
        ...(successor.metadata?.previousValues ?? []),
        factValueFromRow(row, conflictKey, now)
      ]),
      supersedesIds: [...new Set([...(successor.metadata?.supersedesIds ?? []), row.id])]
    }
  }

  private recordEvent(
    memoryId: string,
    eventType: 'created' | 'updated' | 'retrieved' | 'reinforced' | 'archived' | 'deleted' | 'expired',
    sessionId?: string,
    messageId?: string,
    note = ''
  ): void {
    this.db.prepare(`
      INSERT INTO agent_memory_events (id, memory_id, event_type, session_id, message_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), memoryId, eventType, sessionId ?? null, messageId ?? null, note, Date.now())
  }

  private async trim(): Promise<void> {
    const rows = this.db.prepare(`
      SELECT id, importance, confidence, last_used_at, use_count, created_at
      FROM agent_memories
      WHERE status = 'active' AND pinned = 0
    `).all() as Array<Pick<MemoryRow, 'id' | 'importance' | 'confidence' | 'last_used_at' | 'use_count' | 'created_at'>>
    if (rows.length <= MAX_AGENT_MEMORIES) {
      this.pruneEvents()
      return
    }

    // 智能遗忘：按综合价值分（重要度 × 置信度 × 强化）升序淘汰最低者，
    // 而非纯 LRU——让「低重要度但常用」的记忆存活于「高重要度但从不用」之上。
    const now = Date.now()
    const ranked = rows
      .map((row) => ({
        id: row.id,
        salience: memorySalience({
          importance: row.importance,
          confidence: row.confidence,
          lastUsedAt: row.last_used_at,
          useCount: row.use_count,
          createdAt: row.created_at,
          now
        })
      }))
      .sort((a, b) => a.salience - b.salience)
    const doomed = ranked.slice(0, ranked.length - MAX_AGENT_MEMORIES)
    for (const row of doomed) {
      await this.archive(row.id)
    }
    this.pruneEvents()
  }

  /** 裁剪只写审计表，仅保留最近 MAX_MEMORY_EVENTS 条，防止无限增长。 */
  private pruneEvents(): void {
    this.db.prepare(`
      DELETE FROM agent_memory_events
      WHERE id IN (
        SELECT id FROM agent_memory_events ORDER BY created_at DESC LIMIT -1 OFFSET ?
      )
    `).run(MAX_MEMORY_EVENTS)
  }

  private async importLegacyIfNeeded(): Promise<void> {
    if (this.legacyImported) return
    this.legacyImported = true
    const pref = this.db.prepare(`SELECT value FROM app_preferences WHERE key = ?`).get('memory_legacy_imported') as
      | { value: string }
      | undefined
    if (pref?.value === '1') return

    try {
      const raw = await readFile(this.legacyStorePath, 'utf-8')
      const parsed = JSON.parse(raw) as Array<{ id?: string; content?: string; sessionId?: string; createdAt?: number }>
      for (const item of Array.isArray(parsed) ? parsed : []) {
        if (!item.content) continue
        await this.create({
          content: item.content,
          sessionId: item.sessionId,
          sourceType: 'import',
          sourceExcerpt: item.content,
          confidence: 0.55,
          importance: 2
        })
      }
      await unlink(this.legacyStorePath).catch(() => undefined)
    } catch {
      // 没有旧文件是正常情况
    } finally {
      this.db
        .prepare(`INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)`)
        .run('memory_legacy_imported', '1')
    }
  }
}

export const memoryService = new MemoryService()

export const memoryInternalsForTest = {
  memoryFactCandidate,
  memoryConflictKey,
  isMemoryHistoryQuery,
  buildStructuredFact,
  memorySimilarity,
  decideMemoryWrite
}
