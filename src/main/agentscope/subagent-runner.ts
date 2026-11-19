import { isAbsolute, resolve } from 'node:path'
import { Toolkit, Read, Glob, Grep } from '@agentscope-ai/agentscope/tool'
import type { Tool } from '@agentscope-ai/agentscope/tool'
import { Agent } from '@agentscope-ai/agentscope/agent'
import { EventType } from '@agentscope-ai/agentscope/event'
import { createMsg } from '@agentscope-ai/agentscope/message'
import { createChatModel } from './model-factory.js'
import { settingsService } from '../services/settings.service.js'
import { securityService } from '../services/security.service.js'
import { agentRuntimeService } from '../services/agent-runtime.service.js'
import { createLogger } from '../../shared/utils/log.js'
import {
  createCollaborationEvent,
  createCollaborationRun,
  normalizeCollaboratorInputs,
  roleSystemPrompt,
  type AgentCollaborationEvent,
  type AgentCollaborationRun,
  type AgentCollaborationTaskInput,
  type AgentCollaboratorSpec
} from './multi-agent-coordinator.js'

/**
 * 并行子代理 —— 对齐 Hermes 的「派隔离子代理并行干活」。
 *
 * 每个子代理是一个**独立、有界、只读**的 AgentScope Agent（只有 Read/Glob/Grep），
 * 用来并行探索/分析工作区，返回各自的报告，供主 Agent 汇总。刻意只读：并行写会冲突，
 * 写入/命令仍由主 Agent 串行执行。只用 agent-manager 已在用的 API，行为可预期。
 */

const logger = createLogger('main/subagent')
const MAX_SUBAGENTS = 4
const SUBAGENT_MAX_ITERS = 8
const SUBAGENT_PROMPT = `You are a focused, read-only specialist sub-agent working inside a code workspace.
You have Read, Glob, and Grep over the workspace only. Investigate the assigned task thoroughly, then return a concise, self-contained report of your findings: concrete facts, file paths, and code references.
Do not attempt writes, shell commands, or any side effects. Be brief and factual — the main agent will synthesize your report.`

export interface SubagentResult {
  id: string
  role: AgentCollaboratorSpec['role']
  title: string
  task: string
  status: AgentCollaboratorSpec['status']
  report: string
  error?: string
}

export interface SubagentCollaborationResult {
  run: AgentCollaborationRun
  results: SubagentResult[]
  summary: {
    completed: number
    failed: number
    roles: Array<AgentCollaboratorSpec['role']>
  }
}

/** Read/Glob/Grep 的工作区安全护栏（与主工具集一致：解析绝对路径 + 越界拦截）。 */
function guardPath(input: Record<string, unknown>): void {
  for (const key of ['file_path', 'path'] as const) {
    const raw = input[key]
    if (typeof raw !== 'string') continue
    const abs = isAbsolute(raw) ? raw : resolve(securityService.getWorkspaceRoot() ?? process.cwd(), raw)
    securityService.resolveSafePath(abs)
    input[key] = abs
  }
}

function autoGuarded(tool: Tool): Tool {
  const originalCall = tool.call?.bind(tool)
  return {
    ...tool,
    requireUserConfirm: false, // 子代理只读且有界，自动执行、不打断主流程
    call: ((input: Record<string, unknown>) => {
      guardPath(input)
      if (!originalCall) throw new Error(`工具 ${tool.name} 不支持本地执行`)
      return originalCall(input as never)
    }) as Tool['call']
  }
}

function buildReadOnlyToolkit(): Toolkit {
  return new Toolkit({ tools: [autoGuarded(Read()), autoGuarded(Glob()), autoGuarded(Grep())] })
}

async function runOne(
  collaborator: AgentCollaboratorSpec,
  provider: Parameters<typeof createChatModel>[0],
  runId: string,
  events: AgentCollaborationEvent[],
  getAbortSignal?: () => AbortSignal | undefined
): Promise<SubagentResult> {
  try {
    collaborator.status = 'running'
    appendCollaborationEvent(runId, collaborator, 'started', collaborator.task, events)
    const agent = new Agent({
      name: collaborator.title,
      sysPrompt: `${SUBAGENT_PROMPT}\n\n${roleSystemPrompt(collaborator.role)}`,
      model: createChatModel(provider, { getAbortSignal }),
      maxIters: SUBAGENT_MAX_ITERS,
      toolkit: buildReadOnlyToolkit()
    })
    let text = ''
    for await (const event of agent.replyStream({
      msgs: createMsg({ role: 'user', name: 'user', content: collaborator.task })
    })) {
      if (getAbortSignal?.()?.aborted) break
      if (event.type === EventType.TEXT_BLOCK_DELTA) {
        text += event.delta ?? ''
        if (text.length > 0 && text.length % 800 < 20) {
          appendCollaborationEvent(runId, collaborator, 'thinking', `drafted ${text.length} chars`, events)
        }
      }
    }
    if (getAbortSignal?.()?.aborted) {
      collaborator.status = 'failed'
      appendCollaborationEvent(runId, collaborator, 'failed', 'aborted by user', events)
      return {
        id: collaborator.id,
        role: collaborator.role,
        title: collaborator.title,
        task: collaborator.task,
        status: collaborator.status,
        report: '',
        error: 'aborted by user'
      }
    }
    collaborator.status = 'completed'
    const report = text.trim() || '(no output)'
    appendCollaborationEvent(runId, collaborator, 'reported', report.slice(0, 600), events)
    appendCollaborationEvent(runId, collaborator, 'completed', collaborator.title, events)
    return {
      id: collaborator.id,
      role: collaborator.role,
      title: collaborator.title,
      task: collaborator.task,
      status: collaborator.status,
      report
    }
  } catch (error) {
    collaborator.status = 'failed'
    const message = error instanceof Error ? error.message : String(error)
    appendCollaborationEvent(runId, collaborator, 'failed', message, events)
    logger.warn('subagent failed', { task: collaborator.task, role: collaborator.role, error })
    return {
      id: collaborator.id,
      role: collaborator.role,
      title: collaborator.title,
      task: collaborator.task,
      status: collaborator.status,
      report: '',
      error: message
    }
  }
}

/** 并行运行多个只读子代理（上限 MAX_SUBAGENTS），返回各自报告。 */
export async function runSubagents(
  tasks: Array<string | AgentCollaborationTaskInput>,
  options?: { getAbortSignal?: () => AbortSignal | undefined }
): Promise<SubagentCollaborationResult> {
  const provider = await settingsService.getActiveProvider()
  if (!provider) throw new Error('未配置 AI Provider')
  const collaborators = normalizeCollaboratorInputs(tasks, MAX_SUBAGENTS)
  const run = createCollaborationRun(collaborators)
  if (!collaborators.length) {
    return {
      run,
      results: [],
      summary: { completed: 0, failed: 0, roles: [] }
    }
  }
  const runtimeEventId = enqueueCollaborationRun(run)
  logger.info('run subagents', {
    runId: run.runId,
    count: collaborators.length,
    roles: collaborators.map((item) => item.role)
  })
  const results = await Promise.all(
    collaborators.map((collaborator) =>
      runOne(collaborator, provider, run.runId, run.events, options?.getAbortSignal)
    )
  )
  finishCollaborationRun(runtimeEventId, run, results)
  return {
    run,
    results,
    summary: {
      completed: results.filter((item) => item.status === 'completed').length,
      failed: results.filter((item) => item.status === 'failed').length,
      roles: collaborators.map((item) => item.role)
    }
  }
}

function appendCollaborationEvent(
  runId: string,
  collaborator: AgentCollaboratorSpec,
  type: AgentCollaborationEvent['type'],
  message: string,
  events: AgentCollaborationEvent[]
): void {
  events.push(createCollaborationEvent(runId, collaborator, type, message))
  // Runtime trace is best-effort instrumentation: failed observability must not break model execution.
  try {
    agentRuntimeService.recordTurnTool(runId, `子代理:${collaborator.title}`, {
      role: collaborator.role,
      collaboratorId: collaborator.id,
      event: type,
      message: message.slice(0, 1200)
    })
  } catch (error) {
    logger.warn('record subagent trace failed', { runId, collaboratorId: collaborator.id, error })
  }
}

function enqueueCollaborationRun(run: AgentCollaborationRun): string | null {
  try {
    const event = agentRuntimeService.enqueue({
      source: 'background',
      title: '多 Agent 协作',
      detail: run.collaborators.map((item) => `${item.role}: ${item.task}`).join('\n').slice(0, 800),
      priority: 70,
      metadata: {
        runId: run.runId,
        mode: run.mode,
        collaborators: run.collaborators.map((item) => ({
          id: item.id,
          role: item.role,
          title: item.title
        }))
      }
    })
    agentRuntimeService.updateEvent({
      id: event.id,
      status: 'running',
      metadata: { runId: run.runId }
    })
    return event.id
  } catch (error) {
    logger.warn('enqueue subagent collaboration failed', { runId: run.runId, error })
    return null
  }
}

function finishCollaborationRun(
  runtimeEventId: string | null,
  run: AgentCollaborationRun,
  results: SubagentResult[]
): void {
  if (!runtimeEventId) return
  try {
    const failed = results.filter((item) => item.status === 'failed')
    agentRuntimeService.updateEvent({
      id: runtimeEventId,
      status: failed.length ? 'failed' : 'done',
      detail: `完成 ${results.length - failed.length}/${results.length} 个角色协作`,
      metadata: {
        runId: run.runId,
        completed: results.length - failed.length,
        failed: failed.length,
        roles: results.map((item) => item.role)
      }
    })
  } catch (error) {
    logger.warn('finish subagent collaboration failed', { runId: run.runId, error })
  }
}
