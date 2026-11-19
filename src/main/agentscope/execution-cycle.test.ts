import { describe, expect, it } from 'vitest'
import { createExecutionCycle, finishCycle, markCycleStage, renderExecutionCyclePrompt } from './execution-cycle.js'
import type { DynamicWorkflowProfile } from './dynamic-workflow.js'

function workflow(input: Partial<DynamicWorkflowProfile>): DynamicWorkflowProfile {
  return {
    id: input.id ?? 'implement',
    intent: input.intent ?? 'implement',
    risk: input.risk ?? 'medium',
    title: input.title ?? 'Feature Implementation',
    phases: input.phases ?? ['Inspect local patterns', 'Plan change', 'Implement', 'Verify'],
    focus: input.focus ?? ['Type safety'],
    verification: input.verification ?? ['Run type-check'],
    guardrails: input.guardrails ?? ['Preserve unrelated changes']
  }
}

describe('execution cycle', () => {
  it('skips low-risk direct answers', () => {
    const cycle = createExecutionCycle({
      workflow: workflow({ id: 'answer', intent: 'answer', risk: 'low' }),
      agentMode: 'chat',
      approvalMode: 'ask',
      message: '这个函数是什么意思？',
      hasContext: false,
      imageCount: 0
    })

    expect(cycle).toBeNull()
  })

  it('creates an explicit plan-execute-verify loop for broad implementation work', () => {
    const cycle = createExecutionCycle({
      workflow: workflow({ risk: 'medium' }),
      agentMode: 'chat',
      approvalMode: 'auto',
      message: '优化所有页面，要严谨优雅',
      hasContext: true,
      imageCount: 0
    })

    expect(cycle?.steps.map((step) => step.stage)).toContain('plan')
    expect(cycle?.steps.map((step) => step.stage)).toContain('execute')
    expect(cycle?.steps.map((step) => step.stage)).toContain('verify')
    expect(renderExecutionCyclePrompt(cycle!)).toContain('Plan-Execute-Verify')
  })

  it('advances execute and finishes verification without hiding skipped execution', () => {
    const cycle = createExecutionCycle({
      workflow: workflow({ intent: 'review', risk: 'medium' }),
      agentMode: 'chat',
      approvalMode: 'ask',
      message: 'review 一下',
      hasContext: false,
      imageCount: 0
    })!

    const executing = markCycleStage(cycle, 'execute')
    expect(executing.steps.find((step) => step.stage === 'execute')?.status).toBe('running')

    const finished = finishCycle(markCycleStage(cycle, 'verify'), false)
    expect(finished.steps.find((step) => step.stage === 'execute')?.status).toBe('skipped')
    expect(finished.steps.find((step) => step.stage === 'verify')?.status).toBe('done')
  })
})
