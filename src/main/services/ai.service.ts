import type { AIProviderConfig } from '../../shared/types/ai.js'
import type { AgentTitleSummaryRequest } from '../../shared/types/agentscope.js'
import type {
  AIInlineCompletionRequest,
  AIInlineCompletionResult,
  AIInlineEditRequest,
  AIInlineEditResult
} from '../../shared/types/ipc.js'
import { settingsService } from './settings.service.js'
import { securityService } from './security.service.js'

// 说明：对话/Agent 主循环由 AgentScope 承载（src/main/agentscope/*）。本 service 只保留
// 不经 Agent 的“一次性文本请求”能力：标题/提交信息/评审摘要、编辑器内联补全/内联编辑、连接测试。

const TITLE_SYSTEM_PROMPT = `You generate short editor tab titles for an AI coding agent.
Return only the title, no quotes, no markdown, no explanation.
Use the user's language when clear. Prefer 2-8 words. Be specific, concise, and neutral.
Do not include generic words like Agent, Chat, Task, Help, Request, Conversation unless they are the actual subject.`

const COMMIT_SYSTEM_PROMPT = `You write concise Git commit messages for a coding agent.
Return exactly one commit message line, no quotes, no markdown, no explanation.
Use Conventional Commit style when it fits: type(scope): summary.
Prefer concrete scopes from paths or features. Avoid vague words like changes, update files, or misc.
Keep it under 72 characters.`

const GIT_REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer inside an AI coding agent.
Review the supplied Git working tree context and return concise, actionable findings.
Prioritize correctness bugs, behavioral regressions, security/data-loss risks, broken UX, and missing tests.
Do not invent issues. If the diff context is insufficient, say exactly what evidence is missing.
Use this format:
Findings:
- [severity] file/path: concrete issue and why it matters.

Verification:
- Suggested checks or tests.

If you find no concrete issue, say "No concrete issues found in the supplied diff context."`

const INLINE_COMPLETION_SYSTEM_PROMPT = `You generate inline code completions for a code editor.
Return only the text to insert at the cursor.
Rules:
- Do not repeat the existing prefix before the cursor.
- Continue naturally from the current cursor position and file context.
- Prefer useful, locally consistent code over generic placeholders.
- Multi-line completions are allowed when they complete a coherent block.
- Never include markdown fences, explanations, comments about your reasoning, or placeholders.
- Stop at a natural boundary. Do not rewrite existing code after the cursor.
- If no confident completion is possible, return exactly <NO_COMPLETION>.`

const INLINE_EDIT_SYSTEM_PROMPT = `You perform precise inline code edits for a code editor.
Return only the replacement text for the selected code.
Rules:
- Do not add markdown fences or explanations.
- Preserve surrounding style, indentation, and language conventions.
- Only rewrite the selected code to satisfy the instruction.
- When a previous preview is provided, refine that preview instead of starting from scratch.
- If the instruction only needs a small change, keep the output minimal.`

export class AIService {
  private abortControllers = new Map<string, AbortController>()

  async summarizeTitle(request: AgentTitleSummaryRequest): Promise<string> {
    const provider = await settingsService.getActiveProvider()
    if (!provider) throw new Error('未配置 AI Provider')

    const messages = [
      { role: 'system', content: TITLE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          request.locale ? `Locale: ${request.locale}` : '',
          request.workspaceName ? `Workspace: ${request.workspaceName}` : '',
          `User request:\n${excerpt(request.userMessage, 1200)}`,
          request.assistantText ? `Assistant result:\n${excerpt(request.assistantText, 1600)}` : ''
        ].filter(Boolean).join('\n\n')
      }
    ]

    const response = await this.callProvider(provider, messages, {
      temperature: 0.1,
      maxTokens: 48
    })
    return cleanGeneratedTitle(response) || fallbackTitle(request.userMessage)
  }

  async summarizeCommitMessage(request: {
    diffSummary: string
    branch?: string | null
    fallback?: string
  }): Promise<string> {
    const provider = await settingsService.getActiveProvider()
    if (!provider) throw new Error('未配置 AI Provider')

    const messages = [
      { role: 'system', content: COMMIT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          request.branch ? `Branch: ${request.branch}` : '',
          `Git diff summary:\n${excerpt(request.diffSummary, 5000)}`,
          request.fallback ? `Fallback candidate: ${request.fallback}` : ''
        ].filter(Boolean).join('\n\n')
      }
    ]

    const response = await this.callProvider(provider, messages, {
      temperature: 0.1,
      maxTokens: 64
    })
    return cleanCommitMessage(response) || request.fallback || ''
  }

  async reviewGitDiff(request: {
    diffSummary: string
    diffExcerpt: string
    branch?: string | null
  }): Promise<string> {
    const provider = await settingsService.getActiveProvider()
    if (!provider) throw new Error('未配置 AI Provider')

    const messages = [
      { role: 'system', content: GIT_REVIEW_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          request.branch ? `Branch: ${request.branch}` : '',
          `Git status summary:\n${excerpt(request.diffSummary, 6000)}`,
          `Diff excerpt:\n${excerpt(request.diffExcerpt, 12000)}`
        ].filter(Boolean).join('\n\n')
      }
    ]

    const response = await this.callProvider(provider, messages, {
      temperature: 0.1,
      maxTokens: 900
    })
    return cleanReviewSummary(response)
  }

  async completeInline(request: AIInlineCompletionRequest): Promise<AIInlineCompletionResult> {
    const provider = await settingsService.getActiveProvider()
    if (!provider) throw new Error('未配置 AI Provider')

    const controller = new AbortController()
    this.abortControllers.set(request.requestId, controller)
    try {
      const response = await this.callProvider(provider, [
        { role: 'system', content: INLINE_COMPLETION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `File: ${request.filePath}`,
            `Language: ${request.languageId}`,
            'Before cursor:',
            excerpt(request.beforeCursor, 6000),
            '',
            'After cursor:',
            excerpt(request.afterCursor, 2500),
            '',
            `Current line prefix: ${request.linePrefix}`,
            `Current line suffix: ${request.lineSuffix}`,
            `Trigger: ${request.triggerKind ?? 'automatic'}`,
            `Maximum inserted lines: ${request.maxLines ?? 12}`
          ].join('\n')
        }
      ], {
        temperature: 0.2,
        maxTokens: request.triggerKind === 'explicit' ? 420 : 220,
        signal: controller.signal
      })

      return {
        requestId: request.requestId,
        insertText: limitInlineCompletionLines(
          cleanInlineCompletion(response, request.linePrefix),
          request.maxLines ?? 12
        )
      }
    } finally {
      this.abortControllers.delete(request.requestId)
    }
  }

  async generateInlineEdit(request: AIInlineEditRequest): Promise<AIInlineEditResult> {
    const provider = await settingsService.getActiveProvider()
    if (!provider) throw new Error('未配置 AI Provider')

    const controller = new AbortController()
    this.abortControllers.set(request.requestId, controller)
    try {
      const response = await this.callProvider(provider, [
        { role: 'system', content: INLINE_EDIT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `File: ${request.filePath}`,
            `Language: ${request.languageId}`,
            `Instruction: ${request.instruction}`,
            '',
            'Selected code:',
            excerpt(request.selectedText, 8000),
            '',
            ...(request.previousReplacement
              ? [
                  'Previous preview to refine:',
                  excerpt(request.previousReplacement, 8000),
                  ''
                ]
              : []),
            'Context before selection:',
            excerpt(request.beforeSelection, 2500),
            '',
            'Context after selection:',
            excerpt(request.afterSelection, 2500)
          ].join('\n')
        }
      ], {
        temperature: 0.15,
        maxTokens: 1024,
        signal: controller.signal
      })

      return {
        requestId: request.requestId,
        replacement: cleanInlineEdit(response)
      }
    } finally {
      this.abortControllers.delete(request.requestId)
    }
  }

  /** 取消一次进行中的内联补全/内联编辑请求。 */
  abort(requestId: string): void {
    this.abortControllers.get(requestId)?.abort()
  }

  private buildChatUrl(provider: AIProviderConfig): string {
    const base = provider.baseUrl.replace(/\/$/, '')
    if (provider.type === 'ollama') {
      return `${base}/api/chat`
    }
    return `${base}/chat/completions`
  }

  private async callProvider(
    provider: AIProviderConfig,
    messages: Array<{ role: string; content: string }>,
    options: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {}
  ): Promise<string> {
    const url = this.buildChatUrl(provider)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

    if (provider.type === 'ollama') {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens
          }
        }),
        signal: options.signal
      })
      if (!response.ok) {
        throw new Error(await this.formatProviderError(response))
      }
      const json = (await response.json()) as { message?: { content?: string } }
      return json.message?.content ?? ''
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages,
        stream: false,
        temperature: options.temperature,
        max_tokens: options.maxTokens
      }),
      signal: options.signal
    })
    if (!response.ok) {
      throw new Error(await this.formatProviderError(response))
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return json.choices?.[0]?.message?.content ?? ''
  }

  private async formatProviderError(response: Response): Promise<string> {
    const body = await response.text()
    const detail = body ? `: ${securityService.sanitizeForLog(body)}` : ''
    return `AI 请求失败（HTTP ${response.status}）${detail}`
  }

  async testProvider(provider: AIProviderConfig): Promise<{ ok: boolean; message: string }> {
    const base = provider.baseUrl.replace(/\/$/, '')

    try {
      if (provider.type === 'ollama') {
        const response = await fetch(`${base}/api/tags`)
        if (!response.ok) {
          return { ok: false, message: `无法连接 Ollama（HTTP ${response.status}）` }
        }
        const json = (await response.json()) as { models?: Array<{ name: string }> }
        const models = json.models ?? []
        const matched = models.some((m) =>
          m.name === provider.model || m.name.startsWith(`${provider.model}:`)
        )
        if (!matched && models.length > 0) {
          return { ok: false, message: `已连接，但未找到模型「${provider.model}」` }
        }
        return { ok: true, message: matched ? '连接成功' : '连接成功（未检测到本地模型）' }
      }

      const headers: Record<string, string> = {}
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

      const modelsUrl = `${base}/models`
      const response = await fetch(modelsUrl, { headers })
      if (response.ok) {
        return { ok: true, message: '连接成功' }
      }

      const chatUrl = `${base}/chat/completions`
      const chatResponse = await fetch(chatUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
      })
      if (chatResponse.ok) {
        return { ok: true, message: '连接成功' }
      }
      return { ok: false, message: `连接失败（HTTP ${chatResponse.status}）` }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  }

  async listProviderModels(provider: AIProviderConfig): Promise<string[]> {
    const base = provider.baseUrl.trim().replace(/\/$/, '')
    if (!base) throw new Error('请先填写 Base URL')

    if (provider.type === 'ollama') {
      const response = await fetch(`${base}/api/tags`)
      if (!response.ok) {
        throw new Error(`获取 Ollama 模型失败（HTTP ${response.status}）`)
      }
      const json = (await response.json()) as { models?: Array<{ name?: string }> }
      return normalizeModelNames(json.models?.map((model) => model.name))
    }

    const headers: Record<string, string> = {}
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

    const response = await fetch(`${base}/models`, { headers })
    if (!response.ok) {
      throw new Error(`获取模型列表失败（HTTP ${response.status}）`)
    }
    const json = (await response.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> }
    return normalizeModelNames([
      ...(json.data?.map((model) => model.id) ?? []),
      ...(json.models?.map((model) => model.id ?? model.name) ?? [])
    ])
  }
}

export const aiService = new AIService()

function normalizeModelNames(names: Array<string | undefined> | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names ?? []) {
    const name = raw?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function cleanGeneratedTitle(input: string): string {
  const firstLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? ''
  const cleaned = firstLine
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^(title|标题|tab\s*title)\s*[:：]\s*/i, '')
    .replace(/[\s。.!！?？；;，,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''
  return truncateTitle(cleaned)
}

function cleanInlineCompletion(value: string, linePrefix: string): string {
  const cleaned = stripCodeFence(value).trim()
  if (!cleaned || cleaned === '<NO_COMPLETION>') return ''
  return cleaned.startsWith(linePrefix) ? cleaned.slice(linePrefix.length) : cleaned
}

function limitInlineCompletionLines(value: string, maxLines: number): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const bounded = lines.slice(0, Math.max(1, maxLines))
  return bounded.join('\n').replace(/\n+$/g, '')
}

function cleanInlineEdit(value: string): string {
  const cleaned = stripCodeFence(value)
  return cleaned.replace(/^\n+|\n+$/g, '')
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\n?([\s\S]*?)```$/)
  return fenced?.[1] ?? trimmed
}

function cleanCommitMessage(input: string): string {
  const firstLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? ''
  const cleaned = firstLine
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^(commit\s*message|message|提交信息)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned.length > 72 ? cleaned.slice(0, 72).trim() : cleaned
}

function cleanReviewSummary(input: string): string {
  return input
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```$/g, '')
    .trim()
}

function fallbackTitle(text: string): string {
  return truncateTitle(text.replace(/\s+/g, ' ').trim()) || 'New Agent'
}

function truncateTitle(text: string): string {
  const compact = text.trim()
  if (!compact) return ''
  const hasCjk = /[\u3400-\u9fff]/.test(compact)
  const limit = hasCjk ? 24 : 48
  return compact.length > limit ? `${compact.slice(0, limit).trim()}...` : compact
}

function excerpt(content: string, max: number): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max).trim()}...` : compact
}
