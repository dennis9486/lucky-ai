import { describe, expect, it } from 'vitest'
import {
  createCollaborationEvent,
  createCollaborationRun,
  normalizeCollaboratorInputs,
  roleSystemPrompt,
  updateCollaboratorStatus
} from './multi-agent-coordinator.js'

describe('multi-agent coordinator', () => {
  it('normalizes legacy string tasks and role objects into collaborators', () => {
    const collaborators = normalizeCollaboratorInputs([
      'inspect auth flow',
      { role: 'reviewer', title: 'Risk review', task: 'audit browser tools' },
      { role: 'tester', task: 'find missing tests' },
      { role: 'unknown' as never, task: 'fallback role' }
    ], 3)

    expect(collaborators).toHaveLength(3)
    expect(collaborators[0]).toMatchObject({ id: 'agent-1', role: 'generalist', status: 'queued' })
    expect(collaborators[1]).toMatchObject({ role: 'reviewer', title: 'Risk review' })
    expect(collaborators[2]).toMatchObject({ role: 'tester' })
  })

  it('creates an observable collaboration run and status timeline', () => {
    const collaborators = normalizeCollaboratorInputs([
      { role: 'planner', task: 'plan safe rollout' }
    ], 4)
    const run = createCollaborationRun(collaborators)
    updateCollaboratorStatus(collaborators, 'agent-1', 'running')
    const event = createCollaborationEvent(run.runId, collaborators[0], 'started', 'plan safe rollout')

    expect(run.mode).toBe('read_only_workspace')
    expect(run.events[0]).toMatchObject({ type: 'assigned', role: 'planner' })
    expect(collaborators[0].status).toBe('running')
    expect(event).toMatchObject({ runId: run.runId, collaboratorId: 'agent-1', type: 'started' })
  })

  it('injects role-specific operating instructions', () => {
    expect(roleSystemPrompt('reviewer')).toContain('bugs')
    expect(roleSystemPrompt('tester')).toContain('verification')
    expect(roleSystemPrompt('implementer')).toContain('Do not write files')
  })
})
