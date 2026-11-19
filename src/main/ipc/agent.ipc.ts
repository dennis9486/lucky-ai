/**
 * Agent 相关 IPC：对话流、工具确认、会话控制，以及 MCP 连通性探测。
 * 流式事件通过 `AGENT_EVENT:{sessionId}` 推送到发起请求的 renderer webContents。
 */
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { AgentConfirmRequest, AgentSendRequest, AgentTitleSummaryRequest } from '../../shared/types/agentscope.js'
import type { AgentMcpServerConfig, IpcResult, McpServerTestResult } from '../../shared/types/ipc.js'
import { agentScopeManager } from '../agentscope/agent-manager.js'
import { createMcpClient } from '../agentscope/toolkit-factory.js'
import { agentCheckpointService } from '../services/agent-checkpoint.service.js'
import { usageService } from '../services/usage.service.js'
import { aiService } from '../services/ai.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

export function registerAgentIpc(): void {
  /**
   * 发起 AgentScope 流式对话。
   * 立即返回 sessionId，实际 token/工具事件异步推送到 renderer。
   */
  ipcMain.handle(IPC_CHANNELS.AGENT_SEND, async (event, request: AgentSendRequest) => {
    // 优先使用渲染进程预生成的 requestId 作为事件通道键与会话 id，
    // 保证渲染进程已先行订阅，事件不会丢失（abort/confirm 也据此关联）。
    const sessionId = request.requestId ?? randomUUID()
    const sender = event.sender

    // 窗口销毁时主动中止会话：泵在等待事件/HITL 确认时收不到「下一个事件」，
    // 单靠循环里的 isDestroyed 检查无法退出，会话与确认等待会永久悬挂泄漏。
    const onSenderDestroyed = () => agentScopeManager.abort(sessionId)
    sender.once('destroyed', onSenderDestroyed)

    const run = async () => {
      try {
        for await (const agentEvent of agentScopeManager.sendMessage(sessionId, request)) {
          if (sender.isDestroyed()) break
          sender.send(`${IPC_CHANNELS.AGENT_EVENT}:${sessionId}`, agentEvent)
        }
        if (!sender.isDestroyed()) {
          sender.send(`${IPC_CHANNELS.AGENT_EVENT}:${sessionId}`, { type: 'reply_end', sessionId })
        }
      } catch (e) {
        if (!sender.isDestroyed()) {
          sender.send(`${IPC_CHANNELS.AGENT_EVENT}:${sessionId}`, {
            type: 'error',
            sessionId,
            error: String(e)
          })
        }
      } finally {
        sender.removeListener('destroyed', onSenderDestroyed)
      }
    }

    // 先返回 sessionId，再在下个微任务启动流，避免 handler 阻塞导致 renderer 订阅晚于首条事件。
    queueMicrotask(() => {
      void run()
    })

    return ok(sessionId)
  })

  /** 确认或拒绝单个待审批工具调用。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_CONFIRM, (_e, req: AgentConfirmRequest) => {
    agentScopeManager.confirmTools(req)
    return ok(undefined)
  })

  /** 批量确认/拒绝同一轮 reply 下的多个工具调用。 */
  ipcMain.handle(
    IPC_CHANNELS.AGENT_CONFIRM_ALL,
    (_e, sessionId: string, replyId: string, results: Array<{ toolCallId: string; confirmed: boolean }>) => {
      agentScopeManager.confirmAll(sessionId, replyId, results)
      return ok(undefined)
    }
  )

  /** 中止指定 session 的进行中对话。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, (_e, sessionId: string) => {
    agentScopeManager.abort(sessionId)
    return ok(undefined)
  })

  /** 丢弃当前 Agent 实例（模型/工具链变更后需重建）。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_RESET, () => {
    agentScopeManager.invalidateAgent()
    return ok(undefined)
  })

  /** 重置单个会话的 Agent 记忆（编辑/回滚轮次后保持双侧历史一致）。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_RESET_CONVERSATION, async (_e, conversationId: string) => {
    await agentScopeManager.resetConversation(String(conversationId ?? ''))
    return ok(undefined)
  })

  /** 聚合最近 N 天的模型调用用量（用量面板）。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_GET_USAGE_SUMMARY, (_e, days?: number) => {
    try {
      return ok(usageService.getSummary(days))
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 列出某轮捕获的文件前像（UI 据此决定是否展示回滚入口）。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_LIST_TURN_CHECKPOINTS, (_e, turnId: string) =>
    ok(agentCheckpointService.listTurnFiles(String(turnId ?? '')))
  )

  /** 回滚某轮的全部文件修改（恢复前像 / 删除该轮新建文件）。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_REVERT_TURN, async (_e, turnId: string) => {
    try {
      return ok(await agentCheckpointService.revertTurn(String(turnId ?? '')))
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 根据首条用户消息生成会话标题摘要。 */
  ipcMain.handle(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE, async (_e, request: AgentTitleSummaryRequest) => {
    try {
      return ok(await aiService.summarizeTitle(request))
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * 测试 MCP Server 是否可连接，并列出可用工具。
   * 失败时仍返回 success: true，由 payload.ok 表示连通性结果。
   */
  ipcMain.handle(IPC_CHANNELS.AGENT_TEST_MCP, async (_e, server: AgentMcpServerConfig): Promise<IpcResult<McpServerTestResult>> => {
    let client: ReturnType<typeof createMcpClient> | null = null
    try {
      client = createMcpClient(server)
      await client.connect()
      const tools = await client.listTools()
      return ok({
        serverId: server.id,
        ok: true,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description
        }))
      })
    } catch (e) {
      return ok({
        serverId: server.id,
        ok: false,
        tools: [],
        error: String(e)
      })
    } finally {
      await client?.close().catch(() => {})
    }
  })
}
