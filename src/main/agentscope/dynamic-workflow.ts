import type { ApprovalMode } from '../../shared/types/conversation.js'
import type { AgentMode } from '../../shared/types/agentscope.js'

export type DynamicWorkflowIntent =
  | 'answer'
  | 'research'
  | 'review'
  | 'debug'
  | 'implement'
  | 'refactor'
  | 'test'
  | 'git'

export type DynamicWorkflowRisk = 'low' | 'medium' | 'high'

export interface DynamicWorkflowInput {
  message: string
  context?: string
  imageCount?: number
  agentMode: AgentMode
  approvalMode: ApprovalMode
}

export interface DynamicWorkflowProfile {
  id: string
  intent: DynamicWorkflowIntent
  risk: DynamicWorkflowRisk
  title: string
  phases: string[]
  focus: string[]
  verification: string[]
  guardrails: string[]
}

const RESEARCH_RE = /(\b(search|browse|web|latest|current|docs?|release|price|news)\b|查|搜索|联网|最新|官网|文档|资料)/i
const REVIEW_RE = /(\b(review|audit|inspect|diff|pr|code\s*review)\b|审查|评审|检查|review一下)/i
const DEBUG_RE = /(\b(debug|bug|fix|error|crash|fail|exception|trace)\b|报错|修复|错误|异常|失败|崩溃)/i
const IMPLEMENT_RE = /(\b(implement|add|build|create|support|feature)\b|完善|实现|新增|补齐|接入|打通|优化)/i
const REFACTOR_RE = /(\b(refactor|simplify|cleanup|architecture)\b|重构|简化|架构|整理)/i
const TEST_RE = /(\b(test|spec|coverage|vitest|unit|e2e)\b|测试|用例|覆盖率)/i
// 中文触发词必须带 Git 语境：单独的「提交/合并/冲突」在日常语言里太泛
// （提交表单、合并文件、时间冲突），会把无关请求劫持进 Git 工作流。
const GIT_RE = /(\b(git|commit|rebase|stash|push|pull)\b|(创建|新建|切换|删除|检出).{0,4}分支|合并.{0,4}(分支|代码)|解决(合并|git).{0,4}冲突|提交.{0,4}(代码|更改|变更|commit))/i
const RISK_RE = /(\b(delete|remove|migration|database|schema|auth|permission|security|payment|credential|rm\s+-rf)\b|删除|迁移|数据库|权限|安全|凭证|支付|破坏性)/i

/**
 * 延续性消息：自身不携带独立意图，语义完全依赖对话历史
 * （「请继续」、选项字母、简短确认等）。这类消息注入任何工作流指令
 * 都会压过历史——例如助手刚给出 A/B/C 选项、用户回「a」，指令块会让
 * 模型丢掉刚问的问题去执行无关流程。
 */
export function isContinuationMessage(message: string): boolean {
  const text = message.trim()
  if (!text) return true
  // 单选项回复：a / B / 1 / 2)
  if (/^[a-d1-9][)）.。!！]?$/i.test(text)) return true
  // 「继续」类开头：意图在上文里，不在本条消息里
  if (/^(请|麻烦)?(继续|接着|go\s+on|continue|carry\s+on|keep\s+going)/i.test(text)) return true
  // 简短确认/应答
  if (/^(好的?|嗯+|行|可以|没问题|就这样|确认|同意|ok(ay)?|yes|sure|fine|do\s+it)[!！。.~～\s]*$/i.test(text)) return true
  // 过短消息（不含疑问）不足以承载独立工作流意图
  if (text.length <= 2 && !/[?？]/.test(text)) return true
  return false
}

/**
 * 按用户消息选择工作流指令；延续性消息返回 null（不注入指令块）。
 *
 * 意图判定只看用户 message：request.context 是自动收集的项目结构 /
 * @file 引用等内容，里面几乎必然出现 git / 文档 / 优化 等触发词，
 * 参与匹配会让所有消息被同一个（错误的）工作流劫持。
 */
export function selectDynamicWorkflow(input: DynamicWorkflowInput): DynamicWorkflowProfile | null {
  if (isContinuationMessage(input.message)) return null
  const text = input.message.slice(0, 6000)
  const intent = resolveIntent(text, input.agentMode)
  const risk = resolveRisk(text, input)

  const baseGuardrails = [
    'Use the smallest workflow that can safely satisfy the request.',
    'Prefer workspace-aware tools before shell commands.',
    'Preserve unrelated user changes and current editor state.',
    'If the chosen workflow no longer fits after inspection, adapt the plan and state the reason briefly.'
  ]

  const profiles: Record<DynamicWorkflowIntent, Omit<DynamicWorkflowProfile, 'risk' | 'guardrails'>> = {
    answer: {
      id: 'answer',
      intent: 'answer',
      title: 'Direct Answer',
      phases: ['Clarify the question', 'Use available context', 'Answer concisely'],
      focus: ['Accuracy', 'Relevant context only', 'No unnecessary file edits'],
      verification: ['Mention uncertainty or missing context when relevant']
    },
    research: {
      id: 'research',
      intent: 'research',
      title: 'Research Synthesis',
      phases: ['Define the research target', 'Search or fetch authoritative sources', 'Compare evidence', 'Summarize with citations'],
      focus: ['Freshness', 'Source quality', 'Fact/inference separation'],
      verification: ['Cite URLs for external facts', 'Prefer official sources for product or API behavior']
    },
    review: {
      id: 'review',
      intent: 'review',
      title: 'Code Review',
      phases: ['Read Git status and diff', 'Inspect risky hunks', 'Rank findings by severity', 'Suggest focused fixes'],
      focus: ['Bugs', 'Regressions', 'Security', 'Missing tests'],
      verification: ['Ground every finding in file evidence', 'Say clearly when no issue is found']
    },
    debug: {
      id: 'debug',
      intent: 'debug',
      title: 'Debug and Repair',
      phases: ['Reproduce or locate the failure', 'Trace likely root cause', 'Patch narrowly', 'Run targeted verification'],
      focus: ['Error text', 'Recent changes', 'Call chain', 'Regression risk'],
      verification: ['Run the narrowest failing test or type-check first', 'Explain remaining risk if reproduction is unavailable']
    },
    implement: {
      id: 'implement',
      intent: 'implement',
      title: 'Feature Implementation',
      phases: ['Inspect local patterns', 'Plan the smallest coherent change', 'Implement', 'Verify', 'Review diff'],
      focus: ['Existing architecture', 'Type safety', 'Persistence and IPC contracts', 'UI states'],
      verification: ['Run type-check and relevant tests', 'Broaden verification for shared behavior']
    },
    refactor: {
      id: 'refactor',
      intent: 'refactor',
      title: 'Conservative Refactor',
      phases: ['Map current behavior', 'Identify low-risk simplifications', 'Refactor in small steps', 'Verify behavior is preserved'],
      focus: ['No behavior drift', 'Reduced duplication', 'Readable boundaries'],
      verification: ['Run existing tests before broadening scope', 'Avoid formatting-only churn']
    },
    test: {
      id: 'test',
      intent: 'test',
      title: 'Test and Verification',
      phases: ['Identify behavior under test', 'Add or repair focused tests', 'Run targeted tests', 'Report coverage gaps'],
      focus: ['Failure clarity', 'Edge cases', 'Stable fixtures'],
      verification: ['Run the new/changed test and any nearby suite']
    },
    git: {
      id: 'git',
      intent: 'git',
      title: 'Git Workflow',
      phases: ['Read Git status', 'Inspect relevant diffs', 'Perform requested Git action', 'Verify repository state'],
      focus: ['User changes', 'Branch safety', 'Staged vs unstaged separation'],
      verification: ['Never discard or rewrite history without explicit confirmation']
    }
  }

  const selected = profiles[intent]
  return {
    ...selected,
    risk,
    guardrails: [
      ...baseGuardrails,
      ...(risk === 'high'
        ? ['For destructive, migration, security, or broad changes, pause for confirmation unless explicitly authorized.']
        : []),
      ...(input.approvalMode === 'ask'
        ? ['Expect human approval for risky tool calls; keep requested actions explainable.']
        : [])
    ]
  }
}

export function renderDynamicWorkflowPrompt(profile: DynamicWorkflowProfile): string {
  return [
    '## Dynamic workflow directive',
    // 从属声明：指令块只是按「最新一条消息」猜的路由建议；对话历史与用户
    // 明确意图永远优先，猜错时模型应当忽略它而不是照着流程走。
    '- Precedence: this block is advisory routing derived from the latest message only. The conversation history and the user\'s explicit intent always take precedence — if they conflict with this block, ignore it.',
    `- Workflow: ${profile.title} (${profile.id})`,
    `- Intent: ${profile.intent}`,
    `- Risk: ${profile.risk}`,
    `- Phases: ${profile.phases.join(' -> ')}`,
    `- Focus: ${profile.focus.join('; ')}`,
    `- Verification: ${profile.verification.join('; ')}`,
    `- Guardrails: ${profile.guardrails.join('; ')}`
  ].join('\n')
}

function resolveIntent(text: string, agentMode: AgentMode): DynamicWorkflowIntent {
  if (GIT_RE.test(text)) return 'git'
  if (REVIEW_RE.test(text)) return 'review'
  if (DEBUG_RE.test(text)) return 'debug'
  if (REFACTOR_RE.test(text)) return 'refactor'
  if (TEST_RE.test(text)) return 'test'
  if (IMPLEMENT_RE.test(text)) return 'implement'
  if (RESEARCH_RE.test(text)) return 'research'
  return agentMode === 'code' ? 'implement' : 'answer'
}

function resolveRisk(text: string, input: DynamicWorkflowInput): DynamicWorkflowRisk {
  if (RISK_RE.test(text)) return 'high'
  if (input.imageCount && input.imageCount > 0) return 'medium'
  if (input.agentMode === 'code' && input.approvalMode !== 'ask') return 'medium'
  if (IMPLEMENT_RE.test(text) || REFACTOR_RE.test(text) || DEBUG_RE.test(text)) return 'medium'
  return 'low'
}
