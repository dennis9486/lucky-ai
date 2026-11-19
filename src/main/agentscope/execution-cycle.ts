import type { AgentMode } from '../../shared/types/agentscope.js'
import type { ApprovalMode } from '../../shared/types/conversation.js'
import type { DynamicWorkflowProfile } from './dynamic-workflow.js'

export type ExecutionCycleStage = 'plan' | 'execute' | 'verify'
export type ExecutionCycleStatus = 'pending' | 'running' | 'done' | 'skipped'

export interface ExecutionCycleStep {
  id: string
  stage: ExecutionCycleStage
  title: string
  status: ExecutionCycleStatus
}

export interface ExecutionCycle {
  id: string
  title: string
  required: boolean
  reason: string
  risk: DynamicWorkflowProfile['risk']
  intent: DynamicWorkflowProfile['intent']
  steps: ExecutionCycleStep[]
}

export interface ExecutionCycleInput {
  workflow: DynamicWorkflowProfile | null
  agentMode: AgentMode
  approvalMode: ApprovalMode
  message: string
  hasContext: boolean
  imageCount: number
}

const BROAD_CHANGE_RE = /(\b(all|entire|across|architecture|refactor|migration|multi[-\s]?file)\b|所有|全部|整体|架构|重构|迁移|多文件|全面|严谨|优雅)/i

export function createExecutionCycle(input: ExecutionCycleInput): ExecutionCycle | null {
  const workflow = input.workflow
  if (!workflow) return null
  if (workflow.intent === 'answer' && workflow.risk === 'low') return null

  const broad = BROAD_CHANGE_RE.test(input.message)
  const required = workflow.risk !== 'low' ||
    input.agentMode === 'code' ||
    broad ||
    ['implement', 'refactor', 'debug', 'test', 'review', 'git'].includes(workflow.intent)

  if (!required) return null

  const planTitles = normalizePlanTitles(workflow.phases)
  return {
    id: `cycle-${workflow.id}`,
    title: `${workflow.title} execution loop`,
    required,
    reason: [
      `intent:${workflow.intent}`,
      `risk:${workflow.risk}`,
      input.agentMode === 'code' ? 'code-agent' : '',
      broad ? 'broad-change' : '',
      input.hasContext ? 'context-attached' : '',
      input.imageCount ? `images:${input.imageCount}` : ''
    ].filter(Boolean).join(', '),
    risk: workflow.risk,
    intent: workflow.intent,
    steps: [
      ...planTitles.map((title, index) => ({
        id: `plan-${index + 1}`,
        stage: 'plan' as const,
        title,
        status: index === 0 ? 'running' as const : 'pending' as const
      })),
      {
        id: 'execute-1',
        stage: 'execute',
        title: 'Apply the planned actions with the narrowest safe tool sequence',
        status: 'pending'
      },
      {
        id: 'verify-1',
        stage: 'verify',
        title: verificationTitle(workflow),
        status: 'pending'
      }
    ]
  }
}

export function renderExecutionCyclePrompt(cycle: ExecutionCycle): string {
  return [
    '## Plan-Execute-Verify loop',
    '- This turn requires an explicit execution loop. Do not skip directly to changes.',
    `- Reason: ${cycle.reason}`,
    '- Plan: state the concrete steps before tool-heavy work. For broad changes, split by subsystem or file group.',
    '- Execute: follow the plan; if reality differs after inspection, update the plan before continuing.',
    '- Verify: run or name the narrowest meaningful verification. If verification cannot run, explain why and what risk remains.',
    '- Final response: summarize what was planned, executed, and verified.',
    `- Planned phases: ${cycle.steps.filter((step) => step.stage === 'plan').map((step) => step.title).join(' -> ')}`,
    `- Verification target: ${cycle.steps.find((step) => step.stage === 'verify')?.title ?? 'Verify the critical path'}`
  ].join('\n')
}

export function markCycleStage(cycle: ExecutionCycle, stage: ExecutionCycleStage): ExecutionCycle {
  const steps = cycle.steps.map((step) => {
    if (step.stage === stage && step.status === 'pending') return { ...step, status: 'running' as const }
    if (step.stage !== stage && step.status === 'running') return { ...step, status: 'done' as const }
    return step
  })
  return { ...cycle, steps }
}

export function finishCycle(cycle: ExecutionCycle, executed: boolean): ExecutionCycle {
  const steps = cycle.steps.map((step) => {
    if (step.stage === 'execute' && !executed && step.status === 'pending') {
      return { ...step, status: 'skipped' as const }
    }
    if (step.status === 'running' || step.status === 'pending') {
      return { ...step, status: step.stage === 'verify' ? 'done' as const : step.status }
    }
    return step
  })
  return { ...cycle, steps }
}

function normalizePlanTitles(phases: string[]): string[] {
  const titles = phases.map((phase) => phase.trim()).filter(Boolean)
  if (titles.length >= 2) return titles.slice(0, 6)
  return ['Inspect relevant context', 'Decide the smallest safe change']
}

function verificationTitle(workflow: DynamicWorkflowProfile): string {
  return workflow.verification[0] ?? 'Verify the critical path and report residual risk'
}
