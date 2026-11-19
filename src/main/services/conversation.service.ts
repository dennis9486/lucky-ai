import { randomUUID } from 'node:crypto'
import type { ChatMessage } from '../../shared/types/ai.js'
import type { ProjectEntry } from '../../shared/types/project.js'
import type {
  ApprovalMode,
  ConversationState,
  CreateSessionInput,
  LegacyConversationImport,
  LegacyImportResult,
  SessionDetail,
  SessionSummary,
  SessionListOptions,
  UpdateSessionInput
} from '../../shared/types/conversation.js'
import { DatabaseService } from '../db/database.service.js'
import type {
  CodeAgentEffort,
  CodeAgentMode,
  CodeAgentSession,
  CodeAgentTurn,
  PersistedCodeAgentState
} from '../../shared/types/code-agent.js'

const PREF_ACTIVE_SESSION = 'active_session_id'
const PREF_ACTIVE_PROJECT = 'active_project_id'
const PREF_STARTUP_MODE = 'startup_mode'
const PREF_APPROVAL_MODE = 'approval_mode'
const PREF_LEGACY_IMPORTED = 'legacy_import_done'
const PREF_CODE_AGENT_STATE = 'code_agent_state_v2'

interface MessageRow {
  id: string
  session_id: string
  role: ChatMessage['role']
  content: string
  tool_call_id: string | null
  tool_calls_json: string | null
  parts_json: string | null
  meta_json: string | null
  sort_order: number
  timestamp: number
}

interface SessionRow {
  id: string
  title: string
  workspace_name: string
  workspace_path: string | null
  created_at: number
  updated_at: number
  message_count: number
  archived_at: number | null
}

interface CodeAgentStateRow {
  active_session_id: string
  active_session_ids_by_workspace: string | null
  mode: string
  effort: string
}

interface CodeAgentSessionRow {
  id: string
  workspace_name: string | null
  workspace_path: string | null
  title: string
  title_source: string
  conversation_id: string
  last_user_text: string
  reviewed_change_signatures: string
  created_at: number
  updated_at: number
  archived: number
  pinned: number
}

interface CodeAgentTurnRow {
  id: string
  session_id: string
  user_text: string
  parts_json: string
  run_summary: string | null
  created_at: number
  streaming: number
  incomplete: number
  agent_session_id: string | null
}

function rowToMessage(row: MessageRow): ChatMessage {
  const msg: ChatMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp
  }
  if (row.tool_call_id) msg.toolCallId = row.tool_call_id
  if (row.tool_calls_json) {
    try {
      msg.toolCalls = JSON.parse(row.tool_calls_json) as ChatMessage['toolCalls']
    } catch {
      /* ignore corrupt json */
    }
  }
  if (row.parts_json) {
    try {
      msg.parts = JSON.parse(row.parts_json) as ChatMessage['parts']
    } catch {
      /* ignore corrupt json */
    }
  }
  if (row.meta_json) {
    try {
      msg.meta = JSON.parse(row.meta_json) as ChatMessage['meta']
    } catch {
      /* ignore corrupt json */
    }
  }
  return msg
}

function rowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    workspaceName: row.workspace_name,
    workspacePath: row.workspace_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    archivedAt: row.archived_at ?? undefined
  }
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeCodeAgentMode(value: string): CodeAgentMode {
  return value === 'plan' || value === 'debug' || value === 'multitask' || value === 'ask' ? value : 'agent'
}

function normalizeCodeAgentEffort(value: string): CodeAgentEffort {
  return value === 'fast' || value === 'high' ? value : 'auto'
}

function compactText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function partTextSignature(message: ChatMessage): string {
  const parts = message.parts ?? []
  const text = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return compactText(text || message.content)
}

function fullMessageSignature(message: ChatMessage): string {
  return JSON.stringify({
    role: message.role,
    content: compactText(message.content),
    parts: message.parts ?? null,
    toolCallId: message.toolCallId ?? null
  })
}

function hasToolParts(message: ChatMessage): boolean {
  return Boolean(message.parts?.some((part) => part.type === 'tool'))
}

function isDuplicateAssistantMessage(prev: ChatMessage | undefined, next: ChatMessage): boolean {
  if (!prev) return false
  if (prev.id === next.id) return true
  if (prev.role !== 'assistant' || next.role !== 'assistant') return false
  if (fullMessageSignature(prev) === fullMessageSignature(next)) return true
  if (hasToolParts(prev) || hasToolParts(next)) return false
  const prevText = partTextSignature(prev)
  const nextText = partTextSignature(next)
  return Boolean(prevText && prevText === nextText)
}

function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of messages) {
    if (seenIds.has(message.id)) continue
    const previous = result[result.length - 1]
    if (isDuplicateAssistantMessage(previous, message)) continue
    seenIds.add(message.id)
    result.push(message)
  }

  return result
}

function serializeMessageMeta(message: ChatMessage): string | null {
  if (!message.meta || Object.keys(message.meta).length === 0) return null
  return JSON.stringify(message.meta)
}

class ConversationService {
  private get db() {
    return DatabaseService.getInstance().db
  }

  listSessionSummaries(options: SessionListOptions = {}): SessionSummary[] {
    const { includeArchived = false, query } = options
    const conditions: string[] = []
    const params: unknown[] = []

    if (!includeArchived) {
      conditions.push('s.archived_at IS NULL')
    }
    if (query?.trim()) {
      conditions.push('s.title LIKE ?')
      params.push(`%${query.trim()}%`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT s.*,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         ${where}
         ORDER BY s.updated_at DESC`
      )
      .all(...params) as SessionRow[]
    return rows.map(rowToSummary)
  }

  searchSessionSummaries(query: string): SessionSummary[] {
    return this.listSessionSummaries({ query, includeArchived: true })
  }

  getSessionDetail(id: string): SessionDetail | null {
    const row = this.db
      .prepare(
        `SELECT s.*,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s WHERE s.id = ?`
      )
      .get(id) as SessionRow | undefined
    if (!row) return null

    const messages = this.db
      .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order ASC`)
      .all(id) as MessageRow[]

    return {
      ...rowToSummary(row),
      messages: dedupeMessages(messages.map(rowToMessage))
    }
  }

  createSession(input: CreateSessionInput): SessionSummary {
    const id = input.id ?? randomUUID()
    const now = input.updatedAt ?? input.createdAt ?? Date.now()
    const createdAt = input.createdAt ?? now

    this.db
      .prepare(
        `INSERT INTO sessions (id, title, workspace_name, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.title, input.workspaceName, input.workspacePath ?? null, createdAt, now)

    return {
      id,
      title: input.title,
      workspaceName: input.workspaceName,
      workspacePath: input.workspacePath,
      createdAt,
      updatedAt: now,
      messageCount: 0
    }
  }

  updateSession(id: string, input: UpdateSessionInput): SessionSummary | null {
    const existing = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (!existing) return null

    const fields: string[] = []
    const values: unknown[] = []

    if (input.title !== undefined) {
      fields.push('title = ?')
      values.push(input.title)
    }
    if (input.workspaceName !== undefined) {
      fields.push('workspace_name = ?')
      values.push(input.workspaceName)
    }
    if (input.workspacePath !== undefined) {
      fields.push('workspace_path = ?')
      values.push(input.workspacePath)
    }
    if (input.archivedAt !== undefined) {
      fields.push('archived_at = ?')
      values.push(input.archivedAt)
    }
    fields.push('updated_at = ?')
    values.push(input.updatedAt ?? Date.now())
    values.push(id)

    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    const updated = this.db
      .prepare(
        `SELECT s.*,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s WHERE s.id = ?`
      )
      .get(id) as SessionRow | undefined

    return updated ? rowToSummary(updated) : null
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    // Chat 会话的 conversationId 即 session id：级联清理 Agent 持久化上下文与文件前像
    this.db.prepare('DELETE FROM agent_contexts WHERE conversation_id = ?').run(id)
    this.db.prepare('DELETE FROM agent_file_checkpoints WHERE conversation_id = ?').run(id)
    return result.changes > 0
  }

  replaceMessages(sessionId: string, messages: ChatMessage[]): void {
    const nextMessages = dedupeMessages(messages)
    DatabaseService.getInstance().transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
      const insert = this.db.prepare(
        `INSERT INTO messages
          (id, session_id, role, content, tool_call_id, tool_calls_json, parts_json, meta_json, sort_order, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      nextMessages.forEach((msg, index) => {
        insert.run(
          msg.id,
          sessionId,
          msg.role,
          msg.content,
          msg.toolCallId ?? null,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.parts ? JSON.stringify(msg.parts) : null,
          serializeMessageMeta(msg),
          index,
          msg.timestamp
        )
      })
      this.db
        .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
        .run(Date.now(), sessionId)
    })
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    const lastRow = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order DESC LIMIT 1')
      .get(sessionId) as MessageRow | undefined
    if (isDuplicateAssistantMessage(lastRow ? rowToMessage(lastRow) : undefined, message)) {
      return
    }

    const maxOrder = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM messages WHERE session_id = ?')
      .get(sessionId) as { max_order: number }

    this.db
      .prepare(
        `INSERT INTO messages
          (id, session_id, role, content, tool_call_id, tool_calls_json, parts_json, meta_json, sort_order, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        sessionId,
        message.role,
        message.content,
        message.toolCallId ?? null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.parts ? JSON.stringify(message.parts) : null,
        serializeMessageMeta(message),
        maxOrder.max_order + 1,
        message.timestamp
      )

    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(Date.now(), sessionId)
  }

  upsertMessage(sessionId: string, message: ChatMessage): void {
    const existing = this.db
      .prepare('SELECT id, sort_order FROM messages WHERE id = ? AND session_id = ?')
      .get(message.id, sessionId) as { id: string; sort_order: number } | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE messages
           SET role = ?, content = ?, tool_call_id = ?, tool_calls_json = ?, parts_json = ?, meta_json = ?, timestamp = ?
           WHERE id = ? AND session_id = ?`
        )
        .run(
          message.role,
          message.content,
          message.toolCallId ?? null,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.parts ? JSON.stringify(message.parts) : null,
          serializeMessageMeta(message),
          message.timestamp,
          message.id,
          sessionId
        )
    } else {
      const maxOrder = this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM messages WHERE session_id = ?')
        .get(sessionId) as { max_order: number }
      this.db
        .prepare(
          `INSERT INTO messages
            (id, session_id, role, content, tool_call_id, tool_calls_json, parts_json, meta_json, sort_order, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          message.id,
          sessionId,
          message.role,
          message.content,
          message.toolCallId ?? null,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.parts ? JSON.stringify(message.parts) : null,
          serializeMessageMeta(message),
          maxOrder.max_order + 1,
          message.timestamp
        )
    }

    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(Date.now(), sessionId)
  }

  recoverInterruptedStreaming(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order ASC')
      .all(sessionId) as MessageRow[]
    let changed = false
    const messages = rows.map((row) => {
      const message = rowToMessage(row)
      if (!message.meta?.streaming) return message
      changed = true
      return {
        ...message,
        // 崩溃时正在执行的工具永远等不到结果了：把 pending/running 收敛为
        // error 并注明中断，否则卡片（及会话导出）会永久显示「运行中」。
        parts: message.parts?.map((part) =>
          part.type === 'tool' && (part.status === 'running' || part.status === 'pending')
            ? {
                ...part,
                status: 'error' as const,
                output: part.output
                  ? `${part.output}\n[已中断：应用在该工具执行完成前退出]`
                  : '[已中断：应用在该工具执行完成前退出]'
              }
            : part
        ),
        meta: {
          ...message.meta,
          streaming: false,
          incomplete: true
        }
      }
    })
    if (changed) this.replaceMessages(sessionId, messages)
    return messages
  }

  listProjects(): ProjectEntry[] {
    const rows = this.db
      .prepare('SELECT id, name, root_path, added_at FROM projects ORDER BY added_at DESC')
      .all() as Array<{ id: string; name: string; root_path: string; added_at: number }>

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootPath: r.root_path,
      addedAt: r.added_at
    }))
  }

  upsertProject(entry: ProjectEntry): ProjectEntry {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(root_path) DO UPDATE SET
           name = excluded.name,
           id = excluded.id`
      )
      .run(entry.id, entry.name, entry.rootPath, entry.addedAt)
    return entry
  }

  removeProject(id: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return result.changes > 0
  }

  getState(): ConversationState {
    return {
      activeSessionId: this.getPref(PREF_ACTIVE_SESSION),
      activeProjectId: this.getPref(PREF_ACTIVE_PROJECT),
      startupMode: (this.getPref(PREF_STARTUP_MODE) as ConversationState['startupMode']) ?? 'local',
      approvalMode: (this.getPref(PREF_APPROVAL_MODE) as ApprovalMode) ?? 'ask'
    }
  }

  setState(partial: Partial<ConversationState>): ConversationState {
    if (partial.activeSessionId !== undefined) {
      this.setPref(PREF_ACTIVE_SESSION, partial.activeSessionId)
    }
    if (partial.activeProjectId !== undefined) {
      this.setPref(PREF_ACTIVE_PROJECT, partial.activeProjectId)
    }
    if (partial.startupMode !== undefined) {
      this.setPref(PREF_STARTUP_MODE, partial.startupMode)
    }
    if (partial.approvalMode !== undefined) {
      this.setPref(PREF_APPROVAL_MODE, partial.approvalMode)
    }
    return this.getState()
  }

  importLegacy(payload: LegacyConversationImport): LegacyImportResult {
    if (this.getPref(PREF_LEGACY_IMPORTED) === '1') {
      return { imported: false, sessionCount: 0, projectCount: 0 }
    }

    const hasExisting =
      (this.db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c > 0 ||
      (this.db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c > 0

    if (hasExisting) {
      this.setPref(PREF_LEGACY_IMPORTED, '1')
      return { imported: false, sessionCount: 0, projectCount: 0 }
    }

    let sessionCount = 0
    let projectCount = 0

    DatabaseService.getInstance().transaction(() => {
      for (const project of payload.projects ?? []) {
        this.upsertProject(project)
        projectCount++
      }

      for (const session of payload.sessions ?? []) {
        this.createSession({
          id: session.id,
          title: session.title,
          workspaceName: session.workspaceName,
          workspacePath: session.workspacePath,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        })
        if (session.messages.length > 0) {
          this.replaceMessages(session.id, session.messages)
        }
        sessionCount++
      }

      this.setState({
        activeSessionId: payload.activeSessionId ?? null,
        activeProjectId: payload.activeProjectId ?? null,
        startupMode: payload.startupMode ?? 'local',
        approvalMode: payload.approvalMode ?? 'ask'
      })

      this.setPref(PREF_LEGACY_IMPORTED, '1')
    })

    return { imported: true, sessionCount, projectCount }
  }

  getCodeAgentState(): PersistedCodeAgentState | null {
    const stateRow = this.db
      .prepare('SELECT active_session_id, active_session_ids_by_workspace, mode, effort FROM code_agent_state WHERE id = ?')
      .get('default') as CodeAgentStateRow | undefined

    if (!stateRow) {
      const legacy = parseJsonValue<PersistedCodeAgentState | null>(this.getPref(PREF_CODE_AGENT_STATE), null)
      if (!legacy?.sessions?.length) return null
      this.setCodeAgentState(legacy)
      this.setPref(PREF_CODE_AGENT_STATE, null)
      return legacy
    }

    const sessionRows = this.db
      .prepare('SELECT * FROM code_agent_sessions ORDER BY pinned DESC, updated_at DESC')
      .all() as CodeAgentSessionRow[]
    const turnRows = this.db
      .prepare('SELECT * FROM code_agent_turns ORDER BY session_id, sort_order, created_at')
      .all() as CodeAgentTurnRow[]
    const turnsBySession = new Map<string, CodeAgentTurn[]>()

    for (const row of turnRows) {
      const list = turnsBySession.get(row.session_id) ?? []
      list.push({
        id: row.id,
        userText: row.user_text,
        parts: parseJsonValue<CodeAgentTurn['parts']>(row.parts_json, []),
        createdAt: row.created_at,
        streaming: Boolean(row.streaming),
        incomplete: Boolean(row.incomplete),
        runSummary: parseJsonValue<CodeAgentTurn['runSummary']>(row.run_summary, undefined),
        agentSessionId: row.agent_session_id ?? undefined
      })
      turnsBySession.set(row.session_id, list)
    }

    const sessions = sessionRows.map<CodeAgentSession>((row) => ({
      id: row.id,
      workspaceName: row.workspace_name ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      title: row.title,
      titleSource: row.title_source === 'manual' ? 'manual' : 'auto',
      conversationId: row.conversation_id,
      turns: turnsBySession.get(row.id) ?? [],
      reviewedChangeSignatures: parseJsonValue<string[]>(row.reviewed_change_signatures, []),
      lastUserText: row.last_user_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archived: Boolean(row.archived),
      pinned: Boolean(row.pinned)
    }))
    if (!sessions.length) return null

    return {
      activeSessionId: stateRow.active_session_id,
      activeSessionIdsByWorkspace: parseJsonValue<Record<string, string>>(stateRow.active_session_ids_by_workspace, {}),
      mode: normalizeCodeAgentMode(stateRow.mode),
      effort: normalizeCodeAgentEffort(stateRow.effort),
      sessions
    }
  }

  setCodeAgentState(state: PersistedCodeAgentState): void {
    const now = Date.now()
    DatabaseService.getInstance().transaction(() => {
      this.db
        .prepare(
          `INSERT INTO code_agent_state (id, active_session_id, active_session_ids_by_workspace, mode, effort, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_session_id = excluded.active_session_id,
             active_session_ids_by_workspace = excluded.active_session_ids_by_workspace,
             mode = excluded.mode,
             effort = excluded.effort,
             updated_at = excluded.updated_at`
        )
        .run(
          'default',
          state.activeSessionId,
          JSON.stringify(state.activeSessionIdsByWorkspace ?? {}),
          state.mode,
          state.effort,
          now
        )

      this.db.prepare('DELETE FROM code_agent_turns').run()
      this.db.prepare('DELETE FROM code_agent_sessions').run()

      const insertSession = this.db.prepare(
        `INSERT INTO code_agent_sessions
          (id, workspace_name, workspace_path, title, title_source, conversation_id, last_user_text, reviewed_change_signatures,
           created_at, updated_at, archived, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertTurn = this.db.prepare(
        `INSERT INTO code_agent_turns
          (id, session_id, user_text, parts_json, run_summary, created_at, streaming, incomplete, sort_order, agent_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      state.sessions.forEach((session) => {
        insertSession.run(
          session.id,
          session.workspaceName ?? null,
          session.workspacePath ?? null,
          session.title,
          session.titleSource,
          session.conversationId,
          session.lastUserText,
          JSON.stringify(session.reviewedChangeSignatures ?? []),
          session.createdAt,
          session.updatedAt,
          session.archived ? 1 : 0,
          session.pinned ? 1 : 0
        )
        session.turns.forEach((turn, index) => {
          insertTurn.run(
            turn.id,
            session.id,
            turn.userText,
            JSON.stringify(turn.parts),
            turn.runSummary ? JSON.stringify(turn.runSummary) : null,
            turn.createdAt,
            turn.streaming ? 1 : 0,
            turn.incomplete ? 1 : 0,
            index,
            turn.agentSessionId ?? null
          )
        })
      })

      // Code Agent 会话被删除后，其 Agent 上下文与文件前像随之成为孤儿，一并清理
      this.db
        .prepare(
          `DELETE FROM agent_contexts
           WHERE conversation_id LIKE 'code-agent-%'
             AND conversation_id NOT IN (SELECT conversation_id FROM code_agent_sessions)`
        )
        .run()
      this.db
        .prepare(
          `DELETE FROM agent_file_checkpoints
           WHERE conversation_id LIKE 'code-agent-%'
             AND conversation_id NOT IN (SELECT conversation_id FROM code_agent_sessions)`
        )
        .run()
    })
  }

  private getPref(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_preferences WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setPref(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare('DELETE FROM app_preferences WHERE key = ?').run(key)
      return
    }
    this.db
      .prepare(
        `INSERT INTO app_preferences (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }
}

export const conversationService = new ConversationService()
