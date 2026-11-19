import { Toolkit, Read, Write, Edit, Glob, Grep } from '@agentscope-ai/agentscope/tool'
import { readFile } from 'node:fs/promises'
import { securityService } from '../services/security.service.js'
import type { AgentMcpServerConfig } from '../../shared/types/ipc.js'
import type { ApprovalMode } from '../../shared/types/conversation.js'
import { sanitizeToolSchemas } from './json-schema.js'
import { createMcpClient } from './mcp-client.js'
import { patchToolkitToolContext } from './tool-kit-patch.js'
import { getTurnAbortSignal } from './abort-signal.js'
import {
  assertWriteAllowed,
  recordFileRead,
  updateFileSnapshot
} from './file-read-tracker.js'
import {
  captureFileMutation,
  guardFilePath,
  guardSearchPath,
  guardWorkspacePattern,
  wrapTool,
  type BeforeFileMutationHook
} from './tools/tool-helpers.js'
import { createSecureBash } from './tools/bash-tool.js'
import { createWebSearchTool, createWebFetchTool, createWebCrawlTool } from './tools/web-tools.js'
import {
  createCaptureBrowserPageTool,
  createClickBrowserElementTool,
  createControlBrowserTool,
  createFillBrowserInputTool,
  createHoverBrowserElementTool,
  createListBrowserTabsTool,
  createOpenInAppBrowserTool,
  createPressBrowserKeyTool,
  createReadBrowserPageTool,
  createScrollBrowserPageTool,
  createScrollBrowserToTextTool,
  createSnapshotBrowserPageTool,
  createWaitForBrowserTextTool,
  patchBrowserActionConfirm
} from './tools/browser-tools.js'
import { createGitStatusTool, createGitDiffSummaryTool, createGitFileHunksTool } from './tools/git-tools.js'
import { createCalcTool, createTimeTool, createGeneratePdfTool } from './tools/utility-tools.js'
import { createLearnSkillTool, createRunParallelTasksTool, createRunSubagentsTool } from './tools/agent-tools.js'
import { createListScheduledTasksTool, createScheduledTaskTool } from './tools/scheduled-task-tools.js'

/**
 * Toolkit 装配器：把 tools/ 下的各工具群按审批策略装配成工作区限定 Toolkit。
 * 具体工具实现见 tools/*（web/browser/git/utility/agent/bash），
 * 共享防护原语见 tools/tool-helpers.ts，MCP 客户端构造见 mcp-client.ts。
 */

// 既有导入方的兼容出口
export { createMcpClient } from './mcp-client.js'
export type { BeforeFileMutationHook } from './tools/tool-helpers.js'

/**
 * 缓存 toolkit.getJSONSchemas() 的结果并只清洗一次。
 *
 * agentscope 每次模型调用都会调用 getJSONSchemas()，其内部对每个工具做
 * zod→JSON Schema 序列化（toJSONSchema）+ 返回全新对象；叠加我们的 draft-07 清洗，
 * 在一轮多次迭代里是重复的高成本工作。工具集在 agent 生命周期内不变（配置变更会重建
 * toolkit），因此首次计算后缓存复用，消除每次调用的重复序列化/清洗。
 */
function memoizeToolkitSchemas(toolkit: Toolkit): void {
  const original = toolkit.getJSONSchemas.bind(toolkit)
  let cached: ReturnType<typeof original> | null = null
  toolkit.getJSONSchemas = () => {
    if (!cached) {
      cached = original()
      sanitizeToolSchemas(cached)
    }
    return cached
  }
}

export interface WorkspaceToolkitBundle {
  toolkit: Toolkit
  warnings: string[]
  close: () => Promise<void>
}

export interface ApprovalConfirmPolicy {
  readRequiresConfirm: boolean
  writeRequiresConfirm: boolean
  bashRequiresConfirm: boolean
}

export function resolveApprovalConfirmPolicy(
  approvalMode: ApprovalMode = 'ask',
  autoApproveReadOnly = true,
  hasCommandConfirmRule = false
): ApprovalConfirmPolicy {
  return {
    readRequiresConfirm: autoApproveReadOnly === false,
    writeRequiresConfirm: approvalMode === 'ask',
    bashRequiresConfirm: approvalMode !== 'full' || hasCommandConfirmRule
  }
}

/** 构建工作区限定 Toolkit */
export async function createWorkspaceToolkit(options?: {
  skillPaths?: string[]
  skillDirPaths?: string[]
  mcpServers?: AgentMcpServerConfig[]
  approvalMode?: ApprovalMode
  autoApproveReadOnly?: boolean
  /** 文件写盘前钩子（轮次级前像快照），覆盖 Write/Edit/GeneratePdf */
  onBeforeFileMutation?: BeforeFileMutationHook
  /** 遮罩读文件类工具（Read/Grep/Bash）输出中的敏感凭证，默认开启 */
  redactSecretsInOutput?: boolean
  /** 会话键：用于中止信号穿透与 Write 乐观锁 */
  conversationKey?: string
}): Promise<WorkspaceToolkitBundle> {
  const clients: Array<{ close: () => Promise<void> }> = []
  const warnings: string[] = []
  const approvalMode = options?.approvalMode ?? 'ask'
  const approvalPolicy = resolveApprovalConfirmPolicy(
    approvalMode,
    options?.autoApproveReadOnly,
    securityService.hasCommandConfirmRule()
  )
  const shouldConfirmTool = (toolName: string, fallback: boolean): boolean =>
    securityService.shouldConfirmAgentTool(toolName, fallback)
  const redactOutput = options?.redactSecretsInOutput !== false
  const conversationKey = options?.conversationKey
  const getAbortSignal = conversationKey ? () => getTurnAbortSignal(conversationKey) : undefined

  const trackRead = async (input: Record<string, unknown>) => {
    if (!conversationKey) return
    const path = input.file_path
    if (typeof path !== 'string' || !path) return
    try {
      const content = await readFile(path, 'utf-8')
      recordFileRead(conversationKey, path, content)
    } catch {
      // Read 工具自身会报错；此处只维护快照
    }
  }

  const guardWrite = async (input: Record<string, unknown>) => {
    await captureFileMutation(options?.onBeforeFileMutation, input)
    if (conversationKey && typeof input.file_path === 'string') {
      await assertWriteAllowed(conversationKey, input.file_path)
    }
  }

  const trackWrite = async (input: Record<string, unknown>) => {
    if (!conversationKey || typeof input.file_path !== 'string' || typeof input.content !== 'string') return
    updateFileSnapshot(conversationKey, input.file_path, input.content)
  }

  const trackEdit = async (input: Record<string, unknown>) => {
    if (!conversationKey || typeof input.file_path !== 'string') return
    try {
      const content = await readFile(input.file_path, 'utf-8')
      updateFileSnapshot(conversationKey, input.file_path, content)
    } catch {
      // Edit 已成功落盘时文件应可读
    }
  }

  const toolkit = new Toolkit({
    skills: options?.skillPaths ?? [],
    skillDirs: options?.skillDirPaths ?? [],
    tools: [
      wrapTool(Read(), (i) => {
        securityService.assertAgentToolAllowed('Read', i)
        guardFilePath(i)
      }, shouldConfirmTool('Read', approvalPolicy.readRequiresConfirm), undefined, redactOutput, trackRead, conversationKey),
      wrapTool(
        Write(),
        (i) => {
          securityService.assertAgentToolAllowed('Write', i)
          guardFilePath(i)
        },
        shouldConfirmTool('Write', approvalPolicy.writeRequiresConfirm),
        guardWrite,
        false,
        trackWrite,
        conversationKey
      ),
      wrapTool(
        Edit(),
        (i) => {
          securityService.assertAgentToolAllowed('Edit', i)
          guardFilePath(i)
        },
        shouldConfirmTool('Edit', approvalPolicy.writeRequiresConfirm),
        (i) => captureFileMutation(options?.onBeforeFileMutation, i),
        false,
        trackEdit,
        conversationKey
      ),
      wrapTool(Glob(), (i) => {
        securityService.assertAgentToolAllowed('Glob', i)
        guardWorkspacePattern(i)
      }, shouldConfirmTool('Glob', approvalPolicy.readRequiresConfirm), undefined, undefined, undefined, conversationKey),
      wrapTool(Grep(), (i) => {
        securityService.assertAgentToolAllowed('Grep', i)
        guardSearchPath(i)
      }, shouldConfirmTool('Grep', approvalPolicy.readRequiresConfirm), undefined, redactOutput, undefined, conversationKey),
      createWebSearchTool(shouldConfirmTool('WebSearch', approvalPolicy.readRequiresConfirm)),
      createWebFetchTool(shouldConfirmTool('WebFetch', approvalPolicy.readRequiresConfirm)),
      createWebCrawlTool(shouldConfirmTool('WebCrawl', approvalPolicy.readRequiresConfirm)),
      createOpenInAppBrowserTool(shouldConfirmTool('OpenInAppBrowser', approvalPolicy.readRequiresConfirm)),
      createReadBrowserPageTool(shouldConfirmTool('ReadBrowserPage', approvalPolicy.readRequiresConfirm)),
      createControlBrowserTool(shouldConfirmTool('ControlBrowser', approvalPolicy.readRequiresConfirm)),
      createSnapshotBrowserPageTool(shouldConfirmTool('SnapshotBrowserPage', approvalPolicy.readRequiresConfirm)),
      createScrollBrowserToTextTool(shouldConfirmTool('ScrollBrowserToText', approvalPolicy.readRequiresConfirm)),
      createListBrowserTabsTool(shouldConfirmTool('ListBrowserTabs', approvalPolicy.readRequiresConfirm)),
      createScrollBrowserPageTool(shouldConfirmTool('ScrollBrowserPage', approvalPolicy.readRequiresConfirm)),
      // 按键可提交表单：按写类工具管控（ask 模式需确认，reason 进审计）
      createPressBrowserKeyTool(shouldConfirmTool('PressBrowserKey', approvalPolicy.writeRequiresConfirm)),
      createHoverBrowserElementTool(shouldConfirmTool('HoverBrowserElement', approvalPolicy.readRequiresConfirm)),
      createWaitForBrowserTextTool(shouldConfirmTool('WaitForBrowserText', approvalPolicy.readRequiresConfirm)),
      createCaptureBrowserPageTool(shouldConfirmTool('CaptureBrowserPage', approvalPolicy.readRequiresConfirm)),
      // 页面点击/填表是对外可见的动作：按写类工具管控（ask 模式需用户确认，reason 进审计）
      createClickBrowserElementTool(shouldConfirmTool('ClickBrowserElement', approvalPolicy.writeRequiresConfirm)),
      createFillBrowserInputTool(shouldConfirmTool('FillBrowserInput', approvalPolicy.writeRequiresConfirm)),
      createGitStatusTool(shouldConfirmTool('GitStatus', approvalPolicy.readRequiresConfirm)),
      createGitDiffSummaryTool(shouldConfirmTool('GitDiffSummary', approvalPolicy.readRequiresConfirm)),
      createGitFileHunksTool(shouldConfirmTool('GitFileHunks', approvalPolicy.readRequiresConfirm)),
      createListScheduledTasksTool(shouldConfirmTool('ListScheduledTasks', approvalPolicy.readRequiresConfirm)),
      createScheduledTaskTool(shouldConfirmTool('CreateScheduledTask', approvalPolicy.writeRequiresConfirm)),
      createLearnSkillTool(shouldConfirmTool('CreateSkill', approvalPolicy.writeRequiresConfirm)),
      createRunSubagentsTool(shouldConfirmTool('RunSubagents', approvalPolicy.readRequiresConfirm), conversationKey),
      // 可写并行任务：改动最终经主 Agent 审阅 + git apply（Bash/HITL）落地，本身按写类工具管控
      createRunParallelTasksTool(shouldConfirmTool('RunParallelTasks', approvalPolicy.writeRequiresConfirm), conversationKey),
      createCalcTool(shouldConfirmTool('Calc', approvalPolicy.readRequiresConfirm)),
      createTimeTool(shouldConfirmTool('Time', approvalPolicy.readRequiresConfirm)),
      createGeneratePdfTool(shouldConfirmTool('GeneratePdf', approvalPolicy.writeRequiresConfirm), options?.onBeforeFileMutation),
      createSecureBash(shouldConfirmTool('Bash', approvalPolicy.bashRequiresConfirm), redactOutput, getAbortSignal)
    ]
  })

  for (const server of options?.mcpServers ?? []) {
    if (!server.enabled) continue
    try {
      const client = createMcpClient(server)
      await client.connect()
      await toolkit.registerMCPClient({
        client,
        enabledTools: server.enabledTools?.length ? server.enabledTools : undefined,
        disabledTools: server.disabledTools ?? [],
        requireUserConfirm: approvalMode === 'full' ? false : server.requireUserConfirm
      })
      clients.push(client)
    } catch (e) {
      warnings.push(`${server.name}: ${String(e)}`)
    }
  }

  // 所有内建 + MCP 工具注册完毕后再缓存 schema（懒计算，首次模型调用时才真正装配）
  memoizeToolkitSchemas(toolkit)
  patchToolkitToolContext(toolkit, conversationKey)
  // 站点级 AI 操作授权：活动页被设为 auto 时跳过浏览器动作类工具的逐次确认
  patchBrowserActionConfirm(toolkit, approvalPolicy.writeRequiresConfirm)

  return {
    toolkit,
    warnings,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()))
    }
  }
}

/** 切换工作区时更新进程 cwd（AgentScope Bash 依赖 cwd） */
export function syncWorkingDirectory(rootPath: string): void {
  process.chdir(rootPath)
}
