import type { AgentPlan, PlanStep } from '../../shared/types/ai.js'

const PLAN_HEADER = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:计划|Plan|执行计划|Implementation Plan)\s*[：:]?\s*\n/i
const STEP_LINE = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/

/** 从助手回复文本中解析结构化计划 */
export function parsePlanFromText(text: string, id?: string): AgentPlan | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const headerMatch = trimmed.match(PLAN_HEADER)
  const body = headerMatch ? trimmed.slice(headerMatch.index! + headerMatch[0].length) : trimmed

  const lines = body.split('\n')
  const steps: PlanStep[] = []
  let title = '执行计划'

  if (headerMatch) {
    const titleLine = trimmed.slice(0, headerMatch.index).split('\n').pop()?.trim()
    if (titleLine && titleLine.length < 80) title = titleLine.replace(/^#+\s*/, '')
  }

  for (const line of lines) {
    const match = line.match(STEP_LINE)
    if (!match?.[1]) continue
    const stepText = match[1].replace(/\*\*/g, '').trim()
    if (stepText.length < 2) continue
    steps.push({
      id: `step-${steps.length + 1}`,
      text: stepText,
      status: 'pending'
    })
    if (steps.length >= 12) break
  }

  if (steps.length < 2) return null

  return {
    id: id ?? crypto.randomUUID(),
    title,
    steps,
    status: 'pending'
  }
}

export function advancePlanOnToolDone(plan: AgentPlan): AgentPlan {
  const steps = plan.steps.map((s) => ({ ...s }))
  const runningIdx = steps.findIndex((s) => s.status === 'running')
  if (runningIdx >= 0) {
    steps[runningIdx]!.status = 'done'
  }

  const nextPending = steps.findIndex((s) => s.status === 'pending')
  if (nextPending >= 0) {
    steps[nextPending]!.status = 'running'
    return { ...plan, steps, status: 'running' }
  }

  const allDone = steps.every((s) => s.status === 'done')
  return { ...plan, steps, status: allDone ? 'done' : plan.status }
}

export function markPlanRunning(plan: AgentPlan): AgentPlan {
  if (plan.steps.some((s) => s.status === 'running' || s.status === 'done')) return plan
  const steps = plan.steps.map((s, i) => ({
    ...s,
    status: i === 0 ? ('running' as const) : s.status
  }))
  return { ...plan, steps, status: 'running' }
}
