import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import { createLogger } from '../../shared/utils/log.js'
import type {
  AgentRuntimeContextAudit,
  AgentRuntimeContextBuildInput,
  AgentRuntimeContextBuildResult,
  AgentRuntimeContextManifest,
  AgentRuntimeContextSource,
  AgentRuntimeIntent,
  AgentRuntimeIntentKind,
  AgentRuntimeQueueInput,
  AgentRuntimeQueueItem,
  AgentRuntimeQueueUpdateInput,
  AgentRuntimeSnapshot,
  AgentRuntimeState,
  AgentRuntimeToolRegistryItem,
  AgentRuntimeTrace
} from '../../shared/types/agent-runtime.js'
import { DatabaseService } from '../db/database.service.js'
import { memoryService } from './memory.service.js'
import { scheduledTaskService } from './scheduled-task.service.js'
import { workspaceService } from './workspace.service.js'

const logger = createLogger('main/agent-runtime')
const HEARTBEAT_MS = 30_000
const MAX_RECENT_EVENTS = 80
const MAX_RECENT_TRACES = 60
const MAX_RECENT_AUDITS = 30
const MAX_RECENT_MANIFESTS = 30

interface RuntimeEventRow {
  id: string
  source: AgentRuntimeQueueItem['source']
  title: string
  detail: string
  priority: number
  status: AgentRuntimeQueueItem['status']
  metadata_json: string
  created_at: number
  updated_at: number
}

interface TraceRow {
  id: string
  turn_id: string
  phase: AgentRuntimeTrace['phase']
  title: string
  detail_json: string
  created_at: number
}

interface AuditRow {
  id: string
  turn_id: string
  intent_json: string
  budget_chars: number
  used_chars: number
  selected_json: string
  skipped_json: string
  created_at: number
}

interface ManifestRow {
  id: string
  turn_id: string
  source: AgentRuntimeContextManifest['source']
  intent_json: string
  budget_chars: number
  used_chars: number
  sources_json: string
  tools_json: string
  created_at: number
}

const TOOL_REGISTRY: AgentRuntimeToolRegistryItem[] = [
  {
    id: 'find_tool',
    name: 'find_tool',
    description: '按用户意图发现可用工具，避免每轮暴露完整工具表。',
    intents: ['chat', 'tool_discovery'],
    risk: 'low',
    enabled: true,
    requiresConfirmation: false
  },
  {
    id: 'scheduled_tasks',
    name: 'scheduled_tasks',
    description: '创建、编辑、运行和追踪周期任务。',
    intents: ['scheduled_task'],
    risk: 'medium',
    enabled: true,
    requiresConfirmation: true
  },
  {
    id: 'memory',
    name: 'memory',
    description: '检索和写入长期记忆、偏好、项目经验和错误修复记录。',
    intents: ['memory', 'chat', 'code'],
    risk: 'low',
    enabled: true,
    requiresConfirmation: false
  },
  {
    id: 'workspace',
    name: 'workspace',
    description: '读取项目结构、文件搜索、Git 状态和代码审查上下文。',
    intents: ['code', 'file', 'diagnostics'],
    risk: 'medium',
    enabled: true,
    requiresConfirmation: false
  },
  {
    id: 'terminal',
    name: 'terminal',
    description: '执行本地命令、测试、构建和诊断命令。',
    intents: ['code', 'diagnostics'],
    risk: 'high',
    enabled: true,
    requiresConfirmation: true
  },
  {
    id: 'browser',
    name: 'browser',
    description: '读取当前浏览器标签、历史、书签和下载上下文。',
    intents: ['browser', 'search'],
    risk: 'medium',
    enabled: true,
    requiresConfirmation: false
  },
  {
    id: 'file',
    name: 'file',
    description: '读取、创建、更新和删除用户明确选择的文件。',
    intents: ['file', 'code'],
    risk: 'high',
    enabled: true,
    requiresConfirmation: true
  },
  {
    id: 'vision',
    name: 'vision',
    description: '在模型支持多模态时处理图片输入。',
    intents: ['image'],
    risk: 'low',
    enabled: true,
    requiresConfirmation: false
  }
]

export class AgentRuntimeService {
  private state: AgentRuntimeState = 'idle'
  private timer: NodeJS.Timeout | null = null
  private getWindow: (() => BrowserWindow | null) | null = null
  private lastTickAt: number | null = null
  private lastHeartbeatEventAt = 0
  private error: string | undefined

  private get db(): Database.Database {
    return DatabaseService.getInstance().db
  }

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.state = 'error'
        this.error = error instanceof Error ? error.message : String(error)
        logger.error('runtime tick failed', { error })
        this.emitSnapshot()
      })
    }, HEARTBEAT_MS)
    void this.tick()
    logger.info('agent runtime started', { heartbeatMs: HEARTBEAT_MS })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    const now = Date.now()
    this.lastTickAt = now
    this.state = 'maintenance'
    this.error = undefined

    const dueTasks = scheduledTaskService.list({ status: 'active' }).filter((task) => {
      const pending = task.pendingRunAt && (!task.remindAt || task.remindAt <= now)
      const due = task.nextRunAt && task.nextRunAt <= now
      return Boolean(pending || due)
    })
    if (dueTasks.length) {
      for (const task of dueTasks.slice(0, 5)) {
        if (this.hasQueuedTask(task.id)) continue
        this.enqueue({
          source: 'task',
          title: `任务待处理: ${task.title}`,
          detail: task.prompt.slice(0, 500),
          priority: task.pendingRunAt ? 90 : 80,
          metadata: {
            taskId: task.id,
            pendingRunAt: task.pendingRunAt,
            nextRunAt: task.nextRunAt,
            runMode: task.runMode
          }
        }, false)
      }
    } else if (now - this.lastHeartbeatEventAt > 5 * 60 * 1000) {
      this.lastHeartbeatEventAt = now
      this.recordEvent({
        source: 'system',
        title: 'runtime heartbeat',
        detail: 'No due task. Runtime is ready for user, task, reminder and background events.',
        priority: 10,
        metadata: { tickAt: now }
      }, 'done')
    }

    this.state = this.getQueue().some((item) => item.status === 'queued' || item.status === 'running')
      ? 'processing'
      : 'idle'
    this.trim()
    this.emitSnapshot()
  }

  enqueue(input: AgentRuntimeQueueInput, emit = true): AgentRuntimeQueueItem {
    const taskId = typeof input.metadata?.taskId === 'string' ? input.metadata.taskId : null
    if (input.source === 'task' && taskId) {
      const existing = this.findOpenTaskEvent(taskId)
      if (existing) {
        if (emit) this.emitSnapshot()
        return existing
      }
    }
    const item = this.recordEvent(input, 'queued')
    logger.info('runtime event queued', {
      id: item.id,
      source: item.source,
      priority: item.priority,
      title: item.title
    })
    if (emit) this.emitSnapshot()
    return item
  }

  updateEvent(input: AgentRuntimeQueueUpdateInput): AgentRuntimeQueueItem | null {
    const current = this.getEventById(input.id)
    if (!current) return null
    const now = Date.now()
    const item: AgentRuntimeQueueItem = {
      ...current,
      status: input.status,
      detail: input.detail ?? current.detail,
      metadata: { ...current.metadata, ...(input.metadata ?? {}) },
      updatedAt: now
    }
    this.db.prepare(`
      UPDATE agent_runtime_events
      SET status = @status,
          detail = @detail,
          metadata_json = @metadataJson,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({ ...item, metadataJson: JSON.stringify(item.metadata) })
    this.state = this.getQueue().some((event) => event.status === 'queued' || event.status === 'running')
      ? 'processing'
      : 'idle'
    this.emitSnapshot()
    return item
  }

  buildContext(input: AgentRuntimeContextBuildInput): AgentRuntimeContextBuildResult {
    const result = this.buildContextBase(input)
    this.recordContextBuild(result, '上下文注入')
    this.emitSnapshot()
    return result
  }

  async buildContextAsync(input: AgentRuntimeContextBuildInput): Promise<AgentRuntimeContextBuildResult> {
    const base = this.buildContextBase(input)
    const selected = [...base.selected]
    const skipped = [...base.skipped]
    const parts = [base.text]
    const ws = workspaceService.getWorkspace()
    const workspacePath = input.workspacePath ?? ws?.rootPath
    let memorySource = contextSource('memory', '长期记忆', 'memory', 0, base.budgetChars, 'skipped', 'not_checked')

    try {
      const memories = await memoryService.retrieveForPrompt({
        query: input.text,
        workspacePath,
        includeGlobal: true,
        limit: 5,
        minConfidence: 0.35
      })
      if (memories.length) {
        selected.push(`memory:${memories.length}`)
        const memoryText = `## 相关长期记忆\n${memories.map((memory) => `- ${memory.title || memory.summary}: ${memory.summary || memory.content}`).join('\n')}`
        parts.push(memoryText)
        memorySource = contextSource('memory', '长期记忆', 'memory', memoryText.length, base.budgetChars, 'selected')
      } else {
        skipped.push('memory:no_match')
        memorySource = contextSource('memory', '长期记忆', 'memory', 0, base.budgetChars, 'skipped', 'no_match')
      }
    } catch (error) {
      skipped.push('memory:error')
      memorySource = contextSource('memory', '长期记忆', 'memory', 0, base.budgetChars, 'error', 'retrieve_failed')
      logger.warn('memory injection failed', { error })
    }

    const text = fitSections(parts, base.budgetChars, skipped)
    const result: AgentRuntimeContextBuildResult = {
      ...base,
      text,
      selected,
      skipped,
      usedChars: text.length,
      manifest: {
        ...base.manifest,
        usedChars: text.length,
        sources: [...base.manifest.sources, memorySource]
      }
    }
    this.recordEvent({
      source: input.source ?? 'chat',
      title: 'chat context built',
      detail: input.text.slice(0, 500),
      priority: 60,
      metadata: {
        turnId: result.turnId,
        intent: result.intent.primary,
        selected: result.selected,
        skipped: result.skipped
      }
    }, 'done')
    this.recordContextBuild(result, '长期记忆注入')
    this.emitSnapshot()
    return result
  }

  selectToolsForText(text: string): AgentRuntimeToolRegistryItem[] {
    return this.selectTools(classifyIntent(text))
  }

  // ── 真实 Agent 链路埋点（agent-manager 调用，全部容错，绝不阻断会话）──

  /** 记录一轮的意图门控（动态工作流选择结果） */
  recordTurnIntent(turnId: string, detail: Record<string, unknown>): void {
    this.safeRecord(() => this.recordTrace(turnId, 'intent', '动态工作流', detail))
  }

  /**
   * 记录一轮真实注入模型的上下文构成（审计 + trace）。
   * selected/skipped 用 `组件:量` 形态（如 memory:3、referenceContext:1.2k）。
   */
  recordTurnContext(turnId: string, audit: {
    intentText: string
    budgetChars: number
    usedChars: number
    selected: string[]
    skipped: string[]
  }): void {
    this.safeRecord(() => {
      const intent = classifyIntent(audit.intentText)
      this.db.prepare(`
        INSERT INTO agent_context_audits (
          id, turn_id, intent_json, budget_chars, used_chars, selected_json, skipped_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        turnId,
        JSON.stringify(intent),
        audit.budgetChars,
        audit.usedChars,
        JSON.stringify(audit.selected),
        JSON.stringify(audit.skipped),
        Date.now()
      )
      this.recordTrace(turnId, 'context', '上下文注入', {
        selected: audit.selected,
        skipped: audit.skipped,
        usedChars: audit.usedChars,
        budgetChars: audit.budgetChars
      })
    })
  }

  /** 记录一次工具调用结束（名称 + 状态 + 耗时） */
  recordTurnTool(turnId: string, toolName: string, detail: Record<string, unknown>): void {
    this.safeRecord(() => this.recordTrace(turnId, 'tool', toolName, detail))
  }

  /** 记录显式执行闭环阶段：计划、执行、验证。 */
  recordTurnPhase(
    turnId: string,
    phase: Extract<AgentRuntimeTrace['phase'], 'plan' | 'execute' | 'verify'>,
    title: string,
    detail: Record<string, unknown>
  ): void {
    this.safeRecord(() => {
      this.recordTrace(turnId, phase, title, detail)
      this.emitSnapshot()
    })
  }

  /** 记录一轮的最终结果（完成/失败），并落一条运行事件供总控台「最近事件」展示 */
  recordTurnOutcome(turnId: string, input: {
    source: 'chat' | 'code'
    title: string
    ok: boolean
    detail: Record<string, unknown>
  }): void {
    this.safeRecord(() => {
      this.recordTrace(turnId, input.ok ? 'action' : 'error', input.ok ? '回复完成' : '会话失败', input.detail)
      if (input.source === 'code') {
        this.emitSnapshot()
        return
      }
      this.recordEvent({
        source: 'chat',
        title: input.title,
        detail: JSON.stringify(input.detail).slice(0, 500),
        priority: input.ok ? 40 : 80,
        metadata: { turnId, ...input.detail }
      }, input.ok ? 'done' : 'failed')
      this.emitSnapshot()
    })
  }

  /** 外部子系统（页面监控等）落一条已完成事件到「最近事件」，供总控台展示 */
  recordExternalEvent(input: AgentRuntimeQueueInput): void {
    this.safeRecord(() => {
      this.recordEvent(input, 'done')
      this.emitSnapshot()
    })
  }

  /** 埋点绝不抛错：任何记录失败只打日志 */
  private safeRecord(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      logger.warn('runtime instrumentation failed', { error: String(error) })
    }
  }

  getSnapshot(): AgentRuntimeSnapshot {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const stats = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'done' AND updated_at >= @today THEN 1 ELSE 0 END) AS doneToday,
        SUM(CASE WHEN status = 'failed' AND updated_at >= @today THEN 1 ELSE 0 END) AS failedToday
      FROM agent_runtime_events
    `).get({ today: todayStart.getTime() }) as { queued: number | null; running: number | null; doneToday: number | null; failedToday: number | null }

    return {
      state: this.state,
      lastTickAt: this.lastTickAt,
      queue: this.getQueue(),
      recentEvents: this.listEvents(MAX_RECENT_EVENTS),
      traces: this.listTraces(MAX_RECENT_TRACES),
      audits: this.listAudits(MAX_RECENT_AUDITS),
      manifests: this.listManifests(MAX_RECENT_MANIFESTS),
      tools: TOOL_REGISTRY,
      stats: {
        queued: stats.queued ?? 0,
        running: stats.running ?? 0,
        doneToday: stats.doneToday ?? 0,
        failedToday: stats.failedToday ?? 0
      },
      error: this.error
    }
  }

  private buildContextBase(input: AgentRuntimeContextBuildInput): AgentRuntimeContextBuildResult {
    const turnId = input.turnId ?? randomUUID()
    const budgetChars = clamp(input.maxChars ?? 6000, 1200, 16_000)
    const intent = classifyIntent(input.text)
    const selected: string[] = []
    const skipped: string[] = []
    const parts: string[] = []
    const sources: AgentRuntimeContextSource[] = []

    const tools = this.selectTools(intent)
    selected.push(`tools:${tools.map((tool) => tool.id).join(',')}`)
    const toolsText = `## 工具候选\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`
    parts.push(toolsText)
    sources.push(contextSource('tools', '工具候选', 'tools', toolsText.length, budgetChars, 'selected'))

    const ws = workspaceService.getWorkspace()
    if (ws) {
      selected.push('workspace:active')
      const workspaceText = `## 当前项目\n- 名称: ${ws.name}\n- 路径: ${ws.rootPath}`
      parts.push(workspaceText)
      sources.push(contextSource('workspace', '当前项目', 'workspace', workspaceText.length, budgetChars, 'selected'))
    } else {
      skipped.push('workspace:empty')
      sources.push(contextSource('workspace', '当前项目', 'workspace', 0, budgetChars, 'skipped', 'empty'))
    }

    const pendingTasks = scheduledTaskService.list({ status: 'active' })
      .filter((task) => task.pendingRunAt || (task.nextRunAt && task.nextRunAt <= Date.now()))
      .slice(0, 5)
    if (pendingTasks.length) {
      selected.push('scheduled_tasks:due')
      const tasksText = `## 到期/待确认任务\n${pendingTasks.map((task) => {
        const at = task.pendingRunAt ?? task.nextRunAt
        return `- ${task.title} (${task.runMode === 'auto' ? '自动运行' : '运行时确认'}${at ? `, ${new Date(at).toLocaleString()}` : ''})`
      }).join('\n')}`
      parts.push(tasksText)
      sources.push(contextSource('scheduled_tasks', '到期/待确认任务', 'tasks', tasksText.length, budgetChars, 'selected'))
    } else {
      skipped.push('scheduled_tasks:none_due')
      sources.push(contextSource('scheduled_tasks', '到期/待确认任务', 'tasks', 0, budgetChars, 'skipped', 'none_due'))
    }

    const text = fitSections(parts, budgetChars, skipped)
    const manifest: AgentRuntimeContextManifest = {
      id: randomUUID(),
      turnId,
      source: input.source ?? 'chat',
      intent,
      budgetChars,
      usedChars: text.length,
      sources: sources.map((source) => selected.includes(`${source.id}:due`) || source.status !== 'selected'
        ? source
        : { ...source, status: text.includes(source.label) || source.id === 'tools' ? source.status : 'truncated' }),
      tools,
      createdAt: Date.now()
    }
    return {
      turnId,
      intent,
      text,
      selected,
      skipped,
      usedChars: text.length,
      budgetChars,
      tools,
      manifest
    }
  }

  private selectTools(intent: AgentRuntimeIntent): AgentRuntimeToolRegistryItem[] {
    const tools = TOOL_REGISTRY.filter((tool) => {
      if (!tool.enabled) return false
      if (tool.id === 'find_tool') return true
      return tool.intents.includes(intent.primary)
    })
    return tools.length > 1 ? tools : TOOL_REGISTRY.filter((tool) => tool.id === 'find_tool' || tool.intents.includes('chat'))
  }

  private recordEvent(
    input: AgentRuntimeQueueInput,
    status: AgentRuntimeQueueItem['status']
  ): AgentRuntimeQueueItem {
    const now = Date.now()
    const item: AgentRuntimeQueueItem = {
      id: randomUUID(),
      source: input.source,
      title: input.title.trim() || 'runtime event',
      detail: input.detail ?? '',
      priority: clamp(input.priority ?? 50, 0, 100),
      metadata: input.metadata ?? {},
      status,
      createdAt: now,
      updatedAt: now
    }
    this.db.prepare(`
      INSERT INTO agent_runtime_events (
        id, source, title, detail, priority, status, metadata_json, created_at, updated_at
      ) VALUES (
        @id, @source, @title, @detail, @priority, @status, @metadataJson, @createdAt, @updatedAt
      )
    `).run({ ...item, metadataJson: JSON.stringify(item.metadata) })
    return item
  }

  private getQueue(): AgentRuntimeQueueItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runtime_events
      WHERE status IN ('queued', 'running')
      ORDER BY priority DESC, created_at ASC
      LIMIT 50
    `).all() as RuntimeEventRow[]
    return rows.map(rowToEvent)
  }

  private hasQueuedTask(taskId: string): boolean {
    return Boolean(this.findOpenTaskEvent(taskId))
  }

  private findOpenTaskEvent(taskId: string): AgentRuntimeQueueItem | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_runtime_events
      WHERE status IN ('queued', 'running')
        AND source = 'task'
        AND metadata_json LIKE ?
      LIMIT 1
    `).get(`%"taskId":"${taskId}"%`) as RuntimeEventRow | undefined
    return row ? rowToEvent(row) : null
  }

  private getEventById(id: string): AgentRuntimeQueueItem | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_runtime_events
      WHERE id = ?
      LIMIT 1
    `).get(id) as RuntimeEventRow | undefined
    return row ? rowToEvent(row) : null
  }

  private listEvents(limit: number): AgentRuntimeQueueItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runtime_events
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as RuntimeEventRow[]
    return rows.map(rowToEvent)
  }

  private listTraces(limit: number): AgentRuntimeTrace[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runtime_traces
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as TraceRow[]
    return rows.map(rowToTrace)
  }

  private listAudits(limit: number): AgentRuntimeContextAudit[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_context_audits
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as AuditRow[]
    return rows.map(rowToAudit)
  }

  private listManifests(limit: number): AgentRuntimeContextManifest[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_context_manifests
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as ManifestRow[]
    return rows.map(rowToManifest)
  }

  private recordTrace(
    turnId: string,
    phase: AgentRuntimeTrace['phase'],
    title: string,
    detail: Record<string, unknown>
  ): void {
    this.db.prepare(`
      INSERT INTO agent_runtime_traces (id, turn_id, phase, title, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), turnId, phase, title, JSON.stringify(detail), Date.now())
  }

  private recordContextBuild(result: AgentRuntimeContextBuildResult, title: string): void {
    this.auditContext(result)
    this.recordManifest(result.manifest)
    this.recordTrace(result.turnId, 'intent', '意图门控', { intent: result.intent })
    this.recordTrace(result.turnId, 'context', title, {
      selected: result.selected,
      skipped: result.skipped,
      usedChars: result.usedChars,
      budgetChars: result.budgetChars
    })
  }

  private auditContext(result: AgentRuntimeContextBuildResult): void {
    this.db.prepare(`
      INSERT INTO agent_context_audits (
        id, turn_id, intent_json, budget_chars, used_chars, selected_json, skipped_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      result.turnId,
      JSON.stringify(result.intent),
      result.budgetChars,
      result.usedChars,
      JSON.stringify(result.selected),
      JSON.stringify(result.skipped),
      Date.now()
    )
  }

  private recordManifest(manifest: AgentRuntimeContextManifest): void {
    this.db.prepare(`
      INSERT INTO agent_context_manifests (
        id, turn_id, source, intent_json, budget_chars, used_chars, sources_json, tools_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      manifest.id,
      manifest.turnId,
      manifest.source,
      JSON.stringify(manifest.intent),
      manifest.budgetChars,
      manifest.usedChars,
      JSON.stringify(manifest.sources),
      JSON.stringify(manifest.tools),
      manifest.createdAt
    )
  }

  private emitSnapshot(): void {
    const win = this.getWindow?.()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC_CHANNELS.AGENT_RUNTIME_SNAPSHOT, this.getSnapshot())
  }

  private trim(): void {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    this.db.prepare(`DELETE FROM agent_runtime_events WHERE created_at < ? AND status IN ('done', 'failed', 'skipped')`).run(cutoff)
    this.db.prepare(`DELETE FROM agent_runtime_traces WHERE created_at < ?`).run(cutoff)
    this.db.prepare(`DELETE FROM agent_context_audits WHERE created_at < ?`).run(cutoff)
    this.db.prepare(`DELETE FROM agent_context_manifests WHERE created_at < ?`).run(cutoff)
  }
}

function classifyIntent(text: string): AgentRuntimeIntent {
  const normalized = text.toLowerCase()
  const signals: string[] = []
  const match = (kind: AgentRuntimeIntentKind, words: string[]): [AgentRuntimeIntentKind, number] => {
    const hits = words.filter((word) => normalized.includes(word.toLowerCase()))
    if (hits.length) signals.push(...hits.map((hit) => `${kind}:${hit}`))
    return [kind, hits.length]
  }

  const scores = [
    match('scheduled_task', ['任务', '定时', '提醒', '每天', '每周', 'schedule', 'remind', 'daily', 'weekly']),
    match('code', ['代码', '修复', '实现', '报错', '测试', 'code', 'fix', 'bug', 'test', 'refactor']),
    match('browser', ['浏览器', '网页', '书签', '历史', '下载', 'browser', 'tab', 'bookmark', 'history', 'download']),
    match('memory', ['记住', '记忆', '偏好', '以后', 'memory', 'remember', 'preference']),
    match('file', ['文件', '目录', '写入', '读取', 'file', 'folder', 'write', 'read']),
    match('search', ['搜索', '查询', '资料', 'search', 'look up', 'find']),
    match('image', ['图片', '截图', '图中', 'image', 'screenshot', 'vision']),
    match('diagnostics', ['错误', '异常', '日志', '性能', 'error', 'exception', 'log', 'performance']),
    match('tool_discovery', ['工具', '插件', 'tool', 'plugin', 'skill'])
  ]

  scores.sort((a, b) => b[1] - a[1])
  const [primary, score] = scores[0]
  return {
    primary: score > 0 ? primary : 'chat',
    confidence: score > 0 ? Math.min(0.55 + score * 0.15, 0.95) : 0.45,
    signals: signals.slice(0, 12),
    language: detectLanguage(text)
  }
}

function detectLanguage(text: string): AgentRuntimeIntent['language'] {
  const hasZh = /[\u3400-\u9fff]/.test(text)
  const hasEn = /[a-z]/i.test(text)
  if (hasZh && hasEn) return 'mixed'
  if (hasZh) return 'zh'
  if (hasEn) return 'en'
  return 'unknown'
}

function fitSections(parts: string[], maxChars: number, skipped: string[]): string {
  const kept: string[] = []
  let used = 0
  for (const part of parts) {
    if (used + part.length + 2 > maxChars) {
      skipped.push(`budget:${part.slice(0, 24).replace(/\s+/g, ' ')}`)
      continue
    }
    kept.push(part)
    used += part.length + 2
  }
  return kept.join('\n\n')
}

function rowToEvent(row: RuntimeEventRow): AgentRuntimeQueueItem {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    detail: row.detail,
    priority: row.priority,
    status: row.status,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function rowToTrace(row: TraceRow): AgentRuntimeTrace {
  return {
    id: row.id,
    turnId: row.turn_id,
    phase: row.phase,
    title: row.title,
    detail: parseJson<Record<string, unknown>>(row.detail_json, {}),
    createdAt: row.created_at
  }
}

function rowToAudit(row: AuditRow): AgentRuntimeContextAudit {
  return {
    id: row.id,
    turnId: row.turn_id,
    intent: parseJson<AgentRuntimeIntent>(row.intent_json, {
      primary: 'chat',
      confidence: 0,
      signals: [],
      language: 'unknown'
    }),
    budgetChars: row.budget_chars,
    usedChars: row.used_chars,
    selected: parseJson<string[]>(row.selected_json, []),
    skipped: parseJson<string[]>(row.skipped_json, []),
    createdAt: row.created_at
  }
}

function rowToManifest(row: ManifestRow): AgentRuntimeContextManifest {
  return {
    id: row.id,
    turnId: row.turn_id,
    source: row.source,
    intent: parseJson<AgentRuntimeIntent>(row.intent_json, {
      primary: 'chat',
      confidence: 0,
      signals: [],
      language: 'unknown'
    }),
    budgetChars: row.budget_chars,
    usedChars: row.used_chars,
    sources: parseJson<AgentRuntimeContextSource[]>(row.sources_json, []),
    tools: parseJson<AgentRuntimeToolRegistryItem[]>(row.tools_json, []),
    createdAt: row.created_at
  }
}

function contextSource(
  id: string,
  label: string,
  kind: AgentRuntimeContextSource['kind'],
  chars: number,
  budgetChars: number,
  status: AgentRuntimeContextSource['status'],
  reason?: string
): AgentRuntimeContextSource {
  return {
    id,
    label,
    kind,
    chars,
    budgetChars,
    status,
    reason
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

export const agentRuntimeService = new AgentRuntimeService()
