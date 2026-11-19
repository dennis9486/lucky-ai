/**
 * agent-checkpoint.service.ts — Agent 文件修改的轮次级前像快照与回滚
 *
 * 职责：在 Agent 通过 Write / Edit / GeneratePdf 等工具落盘之前，捕获目标
 * 文件的原始内容（前像）到 agent_file_checkpoints 表；用户可按轮（turnId，
 * 即一次 sendMessage 的 sessionId）一键回滚该轮的全部文件修改。
 *
 * 生命周期约定（由 agent-manager 驱动）：
 * - beginTurn(conversationId, turnId)：一轮流式回复开始时登记活跃轮次。
 * - captureBeforeWrite(conversationId, absPath)：工具写盘前调用；同一轮内
 *   同一文件只保留首次前像（唯一索引兜底），无活跃轮次时静默跳过。
 * - endTurn(conversationId)：finally 中注销活跃轮次。
 *
 * 已知边界：
 * - Bash 命令产生的文件修改无法捕获（无结构化路径），回滚只覆盖文件工具。
 * - 单文件超过 MAX_SNAPSHOT_BYTES 不捕获（该文件不可回滚，记录告警）。
 * - 回滚时对每个路径二次做工作区校验，工作区已切换的路径跳过并上报。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type Database from 'better-sqlite3'
import { DatabaseService } from '../db/database.service.js'
import { securityService } from './security.service.js'
import { createLogger } from '../../shared/utils/log.js'
import { isDev } from '../app-env.js'
import type { AgentTurnCheckpointFile, AgentTurnRevertResult } from '../../shared/types/ipc.js'

/** 单文件前像的最大字节数（10MB）；超出则该文件不参与回滚 */
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024

/** 快照保留期：超过 7 天的轮次快照在服务首次使用时清理 */
const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const logger = createLogger('main/agent-checkpoint', {
  debugEnabled: isDev
})

function defaultResolveDb(): Database.Database {
  return DatabaseService.getInstance().db
}

interface CheckpointRow {
  file_path: string
  existed: number
  content: Buffer | null
}

export class AgentCheckpointService {
  /** conversationId → 当前活跃轮次 turnId */
  private readonly activeTurns = new Map<string, string>()
  private pruned = false

  constructor(private readonly resolveDb: () => Database.Database = defaultResolveDb) {}

  private get db(): Database.Database {
    return this.resolveDb()
  }

  /** 登记一轮流式回复开始（同会话重复调用以最新为准） */
  beginTurn(conversationId: string, turnId: string): void {
    this.pruneOnce()
    this.activeTurns.set(conversationId, turnId)
  }

  /** 注销活跃轮次（仅当仍是登记的那一轮，防止并发轮次相互覆盖） */
  endTurn(conversationId: string, turnId: string): void {
    if (this.activeTurns.get(conversationId) === turnId) {
      this.activeTurns.delete(conversationId)
    }
  }

  /**
   * 工具写盘前捕获文件前像。
   * 无活跃轮次（如非 Agent 触发的写入）时为 no-op；同轮同文件只保留首次前像。
   *
   * @param conversationId - 会话标识（与 beginTurn 对应）
   * @param absPath        - 已通过安全校验的绝对路径
   */
  async captureBeforeWrite(conversationId: string, absPath: string): Promise<void> {
    const turnId = this.activeTurns.get(conversationId)
    if (!turnId) return

    // 同轮同文件已有前像则跳过（避免重复读盘；唯一索引是最终兜底）
    const seen = this.db
      .prepare('SELECT 1 FROM agent_file_checkpoints WHERE turn_id = ? AND file_path = ?')
      .get(turnId, absPath)
    if (seen) return

    let existed = 1
    let content: Buffer | null = null
    try {
      const info = await stat(absPath)
      if (!info.isFile()) return
      if (info.size > MAX_SNAPSHOT_BYTES) {
        logger.warn('skip oversized checkpoint snapshot', { turnId, absPath, size: info.size })
        return
      }
      content = await readFile(absPath)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn('skip unreadable checkpoint snapshot', { turnId, absPath, error: String(e) })
        return
      }
      existed = 0
    }

    this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_file_checkpoints
          (id, turn_id, conversation_id, file_path, existed, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), turnId, conversationId, absPath, existed, content, Date.now())
    logger.debug('captured file checkpoint', { turnId, absPath, existed })
  }

  /** 列出某轮捕获的文件前像（供 UI 判断是否展示回滚入口） */
  listTurnFiles(turnId: string): AgentTurnCheckpointFile[] {
    const rows = this.db
      .prepare('SELECT file_path, existed, content FROM agent_file_checkpoints WHERE turn_id = ? ORDER BY created_at ASC')
      .all(turnId) as CheckpointRow[]
    return rows.map((row) => ({
      path: row.file_path,
      existedBefore: row.existed === 1,
      bytes: row.content?.length ?? 0
    }))
  }

  /**
   * 回滚某轮的全部文件修改：恢复前像内容，或删除该轮新建的文件。
   * 幂等：快照保留，重复回滚得到相同结果。路径逐个二次校验，
   * 不在当前工作区内的跳过并计入 skipped。
   */
  async revertTurn(turnId: string): Promise<AgentTurnRevertResult> {
    const rows = this.db
      .prepare('SELECT file_path, existed, content FROM agent_file_checkpoints WHERE turn_id = ? ORDER BY created_at ASC')
      .all(turnId) as CheckpointRow[]

    const result: AgentTurnRevertResult = { restored: [], deleted: [], skipped: [] }
    for (const row of rows) {
      try {
        securityService.resolveSafePath(row.file_path)
      } catch (e) {
        result.skipped.push({ path: row.file_path, reason: String(e) })
        continue
      }

      try {
        if (row.existed === 1) {
          await mkdir(dirname(row.file_path), { recursive: true })
          await writeFile(row.file_path, row.content ?? Buffer.alloc(0))
          result.restored.push(row.file_path)
        } else {
          await rm(row.file_path, { force: true })
          result.deleted.push(row.file_path)
        }
      } catch (e) {
        result.skipped.push({ path: row.file_path, reason: String(e) })
      }
    }

    logger.info('reverted turn checkpoints', {
      turnId,
      restored: result.restored.length,
      deleted: result.deleted.length,
      skipped: result.skipped.length
    })
    return result
  }

  /** 删除某会话的全部快照（会话删除时级联调用） */
  deleteConversationCheckpoints(conversationId: string): void {
    this.db.prepare('DELETE FROM agent_file_checkpoints WHERE conversation_id = ?').run(conversationId)
  }

  /** 首次使用时清理过期快照（每进程一次即可） */
  private pruneOnce(): void {
    if (this.pruned) return
    this.pruned = true
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS
    const removed = this.db.prepare('DELETE FROM agent_file_checkpoints WHERE created_at < ?').run(cutoff)
    if (removed.changes > 0) logger.info('pruned expired checkpoints', { removed: removed.changes })
  }
}

export const agentCheckpointService = new AgentCheckpointService()
