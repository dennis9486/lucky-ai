import type { SettingsData, FileReadResult } from '../../shared/types/ipc.js'
import type { FileTreeNode, WorkspaceGitStatus, WorkspaceInfo } from '../../shared/types/workspace.js'
import type { ChronicleSnapshot } from '../../shared/types/chronicle.js'
import type { AgentRuntimeEventSource } from '../../shared/types/agent-runtime.js'
import type { AgentImageAttachment } from '../../shared/types/agentscope.js'
import { createLogger } from '../../shared/utils/log.js'
import type { ComposerAttachment } from '../stores/ui.store.js'
import { ipc, unwrap } from './ipc-client.js'
import { useUiStore } from '../stores/ui.store.js'
import { useBrowserStore } from '../stores/browser.store.js'
import { isImagePath } from '../utils/mention.js'

const logger = createLogger('renderer/context-builder', {
  debugEnabled: () => {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } }
    return Boolean(meta.env?.DEV)
  }
})

/** 开发环境下记录被跳过的上下文片段，便于排查 */
function warnContextSkip(section: string, error: unknown): void {
  logger.debug('skip context section', { section, error })
}

/** 估算 token 数（字符 / 4） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 裁剪文本到指定 token 上限 */
export function trimToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n... [内容已裁剪]'
}

/**
 * 构建 AI 上下文 — 不塞整个项目
 * 包含：项目结构摘要 + 最近打开文件 + 终端输出摘要 + 显式 @ 引用。
 *
 * 注意：不要在这里重复加入用户原始消息。主进程 agent-manager 会把最新
 * 用户请求放在最终 prompt 的末尾，重复注入会浪费上下文，并可能让自动
 * 上下文里的路由信息压过最新用户意图。
 */
export async function buildContext(
  userMessage: string,
  sessionId?: string,
  attachments?: ComposerAttachment[],
  runtimeSource: AgentRuntimeEventSource = 'chat'
): Promise<string> {
  const settings = await unwrap<SettingsData>(ipc.settings.get())
  const ui = useUiStore()
  const parts: string[] = []

  parts.push(...await buildRuntimeContext(settings, ui, userMessage, sessionId, runtimeSource))
  parts.push(...await buildReferenceSections(userMessage, attachments))

  const full = parts.filter(Boolean).join('\n\n')
  logger.debug('build runtime context', {
    sessionId,
    sectionCount: parts.length,
    promptLength: full.length
  })
  return trimToTokens(full, settings.maxContextTokens)
}

/** 仅解析 @ 引用与附件，不重复注入工作区/Git/目录树（供 Code Agent 等已自带上下文的 prompt 使用） */
export async function buildReferenceContext(
  userMessage: string,
  attachments?: ComposerAttachment[]
): Promise<string> {
  const settings = await unwrap<SettingsData>(ipc.settings.get())
  const sections = await buildReferenceSections(userMessage, attachments)
  if (!sections.length) return ''
  const full = sections.join('\n\n')
  logger.debug('build reference context', {
    sectionCount: sections.length,
    promptLength: full.length
  })
  return trimToTokens(full, Math.min(settings.maxContextTokens, 8000))
}

async function buildRuntimeContext(
  settings: SettingsData,
  ui: ReturnType<typeof useUiStore>,
  userMessage: string,
  sessionId?: string,
  runtimeSource: AgentRuntimeEventSource = 'chat'
): Promise<string[]> {
  const parts: string[] = []

  const runtimeFlags: string[] = []
  if (ui.planMode) runtimeFlags.push('计划模式已开启：先给出可执行计划，再进行修改。')
  if (ui.showGoalInput) runtimeFlags.push('目标模式已请求：如用户输入中包含长期目标，应持续围绕该目标推进。')
  if (ui.attachedRuntime) runtimeFlags.push(`已附加运行时：${ui.attachedRuntime}`)
  if (runtimeFlags.length) {
    parts.push(`## 当前助手模式\n${runtimeFlags.map((flag) => `- ${flag}`).join('\n')}`)
  }

  try {
    const runtimeContext = await unwrap<import('../../shared/types/agent-runtime.js').AgentRuntimeContextBuildResult>(ipc.agentRuntime.buildContext({
      text: userMessage,
      sessionId,
      source: runtimeSource,
      maxChars: Math.min(settings.maxContextTokens * 2, 6000)
    }))
    if (runtimeContext.text.trim()) {
      parts.push(`## Agent Runtime / ACI\n${runtimeContext.text}`)
    }
  } catch (error) {
    warnContextSkip('agent runtime context', error)
  }

  // 并行发起互相独立的 IPC（chronicle 与 workspace），减少每条消息构建上下文的串行往返延迟。
  const chroniclePromise: Promise<ChronicleSnapshot | null> = settings.personalization?.chroniclePreview
    ? unwrap<ChronicleSnapshot>(ipc.chronicle.getSnapshot(sessionId)).catch((error) => {
        warnContextSkip('chronicle', error)
        return null
      })
    : Promise.resolve(null)
  const wsPromise: Promise<WorkspaceInfo | null> = unwrap<WorkspaceInfo | null>(ipc.workspace.get()).catch((error) => {
    warnContextSkip('workspace', error)
    return null
  })

  const snapshot = await chroniclePromise
  if (snapshot) {
    const chronicleLines: string[] = []
    if (snapshot.workspaceSummary) chronicleLines.push(snapshot.workspaceSummary)
    for (const thread of snapshot.threads) {
      chronicleLines.push(
        `- [${thread.title}] 用户: ${thread.lastUserMessage || '—'} | 助手: ${thread.lastAssistantSnippet || '—'}`
      )
    }
    for (const memory of snapshot.memories) {
      chronicleLines.push(`- 记忆: ${memory}`)
    }
    if (chronicleLines.length) {
      parts.push(`## Chronicle 上下文\n${chronicleLines.join('\n')}`)
    }
  }

  // 工作区信息
  const ws = await wsPromise
  if (ws) {
    parts.push(`## 工作区\n- 名称: ${ws.name}\n- 路径: ${ws.rootPath}`)
    // git 状态与目录树互相独立，并行获取。
    const [gitResult, treeResult] = await Promise.allSettled([
      unwrap<WorkspaceGitStatus>(ipc.workspace.getGitStatus(ws.rootPath)),
      unwrap<FileTreeNode[]>(ipc.workspace.getTree())
    ])

    if (gitResult.status === 'fulfilled') {
      const git = gitResult.value
      if (git.isRepository) {
        const gitLines = [
          `- 分支: ${git.branch ?? '未知'}`,
          `- HEAD: ${git.head ?? '未知'}`,
          `- 上游: ${git.upstream ?? '未设置'}`,
          `- ahead/behind: ${git.ahead ?? 0}/${git.behind ?? 0}`,
          `- 未提交文件: ${git.dirtyCount}`
        ]
        if (git.detached) gitLines.push('- 状态: detached HEAD')
        if (git.files?.length) {
          gitLines.push(
            '- 变更摘要:',
            ...git.files.slice(0, 20).map((file) => `  - ${file.index}${file.workingTree} ${file.path}`)
          )
          if (git.files.length > 20) gitLines.push(`  - ... 还有 ${git.files.length - 20} 个文件`)
        }
        parts.push(`## Git 状态\n${gitLines.join('\n')}`)
      } else {
        parts.push('## Git 状态\n- 当前工作区不是 Git 仓库')
      }
    } else {
      warnContextSkip('git status', gitResult.reason)
    }

    if (treeResult.status === 'fulfilled') {
      const fileList = flattenTree(treeResult.value).slice(0, 60)
      parts.push(`## 项目结构 (前 ${fileList.length} 项)\n${fileList.map((f) => `- ${f}`).join('\n')}`)
    } else {
      warnContextSkip('workspace tree', treeResult.reason)
    }
  }

  return parts
}

async function buildReferenceSections(
  userMessage: string,
  attachments?: ComposerAttachment[]
): Promise<string[]> {
  const parts: string[] = []
  const ui = useUiStore()
  const composerAttachments = attachments ?? ui.composerAttachments

  if (composerAttachments.length) {
    const attachmentBlocks: string[] = []
    for (const item of composerAttachments) {
      if (item.kind === 'image') {
        attachmentBlocks.push(`- [图片] ${item.name} (${item.path}) — 已作为视觉输入发送给支持多模态的模型`)
        continue
      }
      if (item.kind === 'file') {
        try {
          const file = await unwrap<FileReadResult>(ipc.file.read(item.path))
          attachmentBlocks.push(
            `- 文件 ${item.path}\n\`\`\`\n${trimToTokens(file.content, 1500)}\n\`\`\``
          )
        } catch (error) {
          attachmentBlocks.push(`- 文件 ${item.path} (读取失败)`)
          warnContextSkip(`attachment file ${item.path}`, error)
        }
        continue
      }
      try {
        const folderTree = await unwrap<FileTreeNode[]>(ipc.workspace.getTree())
        const files = listFilesUnder(folderTree, item.path)
        attachmentBlocks.push(`- 目录 ${item.path}\n${files.slice(0, 25).join('\n')}`)
      } catch (error) {
        attachmentBlocks.push(`- 目录 ${item.path}`)
        warnContextSkip(`attachment folder ${item.path}`, error)
      }
    }
    parts.push(`## 已附加上下文\n${attachmentBlocks.join('\n\n')}`)
  }

  const refs = parseReferences(userMessage)
  const includeTerminal = refs.some((r) => r.type === 'terminal')
  const includeBrowser = refs.some((r) => r.type === 'browser')

  if (includeTerminal) {
    try {
      const termOut = await unwrap<{ id: string; output: string }>(ipc.terminal.getOutput())
      if (termOut.output) {
        parts.push(`## 终端输出 (@terminal)\n${trimToTokens(termOut.output, 500)}`)
      }
    } catch (error) { warnContextSkip('terminal output', error) }
  }

  if (includeBrowser) {
    try {
      const browserStore = useBrowserStore()
      const lines: string[] = []
      if (browserStore.activeTabUrl) {
        lines.push(`- 当前标签: ${browserStore.activeTabTitle || '—'} (${browserStore.activeTabUrl})`)
      }
      const history = await unwrap<Array<{ title: string; url: string }>>(ipc.browser.listHistory(8))
      for (const item of history) {
        if (item.url === browserStore.activeTabUrl) continue
        lines.push(`- ${item.title}: ${item.url}`)
      }
      if (lines.length) {
        parts.push(`## 浏览器上下文 (@browser)\n${lines.join('\n')}`)
      }
    } catch (error) { warnContextSkip('browser history', error) }
  }

  for (const ref of refs) {
    if (ref.type === 'file') {
      try {
        if (isImagePath(ref.path)) {
          parts.push(`## 引用图片: ${ref.path}\n[图片已作为视觉输入发送给支持多模态的模型]`)
          continue
        }
        const file = await unwrap<FileReadResult>(ipc.file.read(ref.path))
        parts.push(`## 引用文件: ${ref.path}\n\`\`\`\n${trimToTokens(file.content, 2000)}\n\`\`\``)
      } catch (error) { warnContextSkip(`file ref ${ref.path}`, error) }
    }
    if (ref.type === 'folder') {
      try {
        const folderTree = await unwrap<FileTreeNode[]>(ipc.workspace.getTree())
        const files = listFilesUnder(folderTree, ref.path)
        parts.push(`## 引用目录: ${ref.path}\n${files.slice(0, 30).join('\n')}`)
      } catch (error) { warnContextSkip(`file ref ${ref.path}`, error) }
    }
  }

  return parts
}

export function buildImageAttachments(
  userMessage: string,
  includeComposerAttachments = true,
  attachments?: ComposerAttachment[]
): AgentImageAttachment[] {
  const ui = useUiStore()
  const images = new Map<string, AgentImageAttachment>()

  if (includeComposerAttachments) {
    for (const item of attachments ?? ui.composerAttachments) {
      if (item.kind === 'image') {
        images.set(item.path, { path: item.path, name: item.name })
      }
    }
  }

  for (const ref of parseReferences(userMessage)) {
    if (ref.type === 'file' && isImagePath(ref.path)) {
      images.set(ref.path, {
        path: ref.path,
        name: ref.path.split(/[/\\]/).filter(Boolean).pop() ?? ref.path
      })
    }
  }

  return [...images.values()]
}

function flattenTree(nodes: FileTreeNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file') result.push(node.path)
    if (node.children) flattenTree(node.children, result)
  }
  return result
}

function listFilesUnder(nodes: FileTreeNode[], folderPath: string): string[] {
  const prefix = folderPath.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '')
  return flattenTree(nodes).filter((path) => {
    const normalized = path.replace(/\\/g, '/')
    return !prefix || normalized === prefix || normalized.startsWith(`${prefix}/`)
  })
}

import { parseReferences } from '../utils/references.js'
