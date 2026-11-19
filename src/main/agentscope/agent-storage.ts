/**
 * agent-storage.ts — AgentScope 会话上下文的 SQLite 持久化
 *
 * 实现 AgentScope 的 StorageBase：Agent 每轮 reply 开始时 loadState()、
 * 结束时 saveState()，本模块把完整对话上下文（含工具调用/结果与压缩摘要
 * 元数据）按 conversation_id 落到 agent_contexts 表。应用重启或 Agent 缓存
 * 失效重建后，新 Agent 实例首次 reply 会自动恢复历史上下文，会话不失忆。
 *
 * 设计约束：
 * - 每个会话一个 storage 实例（conversationKey 即主键），忽略框架传入的
 *   agentId（所有 Agent 同名 "Lucky"，不能用作区分键）。
 * - 体积护栏：序列化后超过 MAX_PERSISTED_CONTEXT_BYTES 时从最旧消息开始
 *   丢弃（AgentScope 压缩通常已先行收敛，这里是落库前的最后防线）。
 * - 读取容错：JSON 损坏或结构不符时回退为空状态，绝不让一条坏记录卡死会话。
 */

import { StorageBase } from '@agentscope-ai/agentscope/storage'
import type { AgentState } from '@agentscope-ai/agentscope/storage'
import type { Msg } from '@agentscope-ai/agentscope/message'
import type Database from 'better-sqlite3'
import { DatabaseService } from '../db/database.service.js'
import { createLogger } from '../../shared/utils/log.js'
import { isDev } from '../app-env.js'

/** 单条会话上下文序列化后的最大字节数（超出则丢弃最旧消息） */
const MAX_PERSISTED_CONTEXT_BYTES = 4 * 1024 * 1024

const logger = createLogger('main/agent-storage', {
  debugEnabled: isDev
})

/** 默认 DB 解析器：复用应用级单例（测试可注入 :memory: 库） */
function defaultResolveDb(): Database.Database {
  return DatabaseService.getInstance().db
}

interface AgentContextRow {
  context_json: string
  metadata_json: string
}

/**
 * 落库前裁剪上下文：从最旧消息开始丢弃，直到序列化体积进入预算。
 * 至少保留最后一条消息（哪怕它单条超预算），保证恢复后仍有最近锚点。
 *
 * @param context  - 完整对话上下文
 * @param maxBytes - 序列化字节预算
 * @returns 裁剪后的上下文（未超预算时原样返回）
 */
function trimContextForPersistence(context: Msg[], maxBytes: number): Msg[] {
  let trimmed = context
  while (trimmed.length > 1 && Buffer.byteLength(JSON.stringify(trimmed), 'utf-8') > maxBytes) {
    trimmed = trimmed.slice(1)
  }
  return trimmed
}

interface ToolCallBlockLike {
  type: 'tool_call'
  id: string
  name: string
  state?: string
}

interface ToolResultBlockLike {
  type: 'tool_result'
  id: string
}

/**
 * 修复中断轮次留下的悬空 tool_call（有调用、无结果）。
 *
 * AgentScope 把 tool_call 与 tool_result 存在同一条 assistant 消息里；
 * 轮次被中止/应用退出时，saveState 落库的上下文可能带着无结果的 tool_call。
 * 恢复后第一次 reply 会因 `_getAwaitingToolCalls()` 判定「等待确认中」而直接
 * 抛错（"Agent is awaiting for 'USER_CONFIRM_RESULT'…"），会话从此卡死；
 * 即使不抛错，悬空调用发给严格校验的 OpenAI 兼容端点也会 400。
 * 读取侧补一条 interrupted 结果块（与 AgentScope 拒绝执行时的形态一致），
 * 写入侧保持原样（落库保真，修复只发生在恢复时）。
 */
function repairInterruptedToolCalls(context: Msg[], conversationId: string): Msg[] {
  let repaired = 0
  for (const message of context) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const blocks = message.content as Array<ToolCallBlockLike | ToolResultBlockLike | { type: string }>
    const resultIds = new Set(
      blocks.filter((block): block is ToolResultBlockLike => block.type === 'tool_result').map((block) => block.id)
    )
    for (const block of blocks) {
      if (block.type !== 'tool_call') continue
      const call = block as ToolCallBlockLike
      if (resultIds.has(call.id)) continue
      call.state = 'finished'
      blocks.push({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        output: [{
          id: crypto.randomUUID(),
          type: 'text',
          text: `<system-info>**Note** tool "${call.name}" was interrupted before completion (the previous turn was stopped); no result was produced.</system-info>`
        }],
        state: 'interrupted'
      } as ToolResultBlockLike & Record<string, unknown>)
      repaired += 1
    }
  }
  if (repaired > 0) {
    logger.warn('repaired dangling tool calls from interrupted turn', { conversationId, repaired })
  }
  return context
}

/** 解析持久化 JSON；损坏时回退 fallback 并告警，避免坏记录阻断会话 */
function parsePersistedJson<T>(raw: string, fallback: T, field: string, conversationId: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    logger.warn('discard corrupt persisted agent state', { conversationId, field })
    return fallback
  }
}

/**
 * SQLite 版 AgentScope StorageBase。
 * 一个实例服务一个会话（conversationKey），由 agent-manager 在创建 Agent 时注入。
 */
export class SqliteAgentStorage extends StorageBase {
  constructor(
    private readonly conversationId: string,
    private readonly resolveDb: () => Database.Database = defaultResolveDb
  ) {
    super()
  }

  async loadAgentState(): Promise<AgentState> {
    const row = this.resolveDb()
      .prepare('SELECT context_json, metadata_json FROM agent_contexts WHERE conversation_id = ?')
      .get(this.conversationId) as AgentContextRow | undefined
    if (!row) return { context: [], metadata: {} }

    const context = parsePersistedJson<Msg[]>(row.context_json, [], 'context', this.conversationId)
    const metadata = parsePersistedJson<Record<string, unknown>>(row.metadata_json, {}, 'metadata', this.conversationId)
    if (!Array.isArray(context)) {
      logger.warn('persisted agent context is not an array, resetting', { conversationId: this.conversationId })
      return { context: [], metadata: {} }
    }

    logger.debug('restore agent context', { conversationId: this.conversationId, messages: context.length })
    return { context: repairInterruptedToolCalls(context, this.conversationId), metadata }
  }

  async saveAgentState(options: { context: Msg[]; metadata: Record<string, unknown> }): Promise<void> {
    const context = trimContextForPersistence(options.context, MAX_PERSISTED_CONTEXT_BYTES)
    this.resolveDb()
      .prepare(
        `INSERT INTO agent_contexts (conversation_id, context_json, metadata_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           context_json = excluded.context_json,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`
      )
      .run(this.conversationId, JSON.stringify(context), JSON.stringify(options.metadata ?? {}), Date.now())
  }
}

/**
 * 删除某会话的持久化上下文。
 * 用于「编辑/回滚轮次」等需要重置 Agent 记忆的场景（与缓存 Agent 一并清理）。
 */
export function deleteAgentContext(
  conversationId: string,
  resolveDb: () => Database.Database = defaultResolveDb
): void {
  resolveDb().prepare('DELETE FROM agent_contexts WHERE conversation_id = ?').run(conversationId)
}

/** 仅测试使用 */
export const agentStorageInternalsForTest = {
  trimContextForPersistence,
  repairInterruptedToolCalls,
  MAX_PERSISTED_CONTEXT_BYTES
}
