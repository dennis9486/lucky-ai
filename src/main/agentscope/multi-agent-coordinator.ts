import { randomUUID } from 'node:crypto'

export type AgentCollaboratorRole =
  | 'researcher'
  | 'reviewer'
  | 'planner'
  | 'tester'
  | 'browser'
  | 'implementer'
  | 'generalist'

export type AgentCollaborationEventType =
  | 'assigned'
  | 'started'
  | 'thinking'
  | 'reported'
  | 'completed'
  | 'failed'

export interface AgentCollaboratorSpec {
  id: string
  role: AgentCollaboratorRole
  title: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'failed'
}

export interface AgentCollaborationEvent {
  id: string
  runId: string
  collaboratorId: string
  role: AgentCollaboratorRole
  type: AgentCollaborationEventType
  message: string
  createdAt: number
}

export interface AgentCollaborationTaskInput {
  task: string
  role?: AgentCollaboratorRole | string
  title?: string
}

export interface AgentCollaborationRun {
  runId: string
  mode: 'read_only_workspace'
  startedAt: number
  collaborators: AgentCollaboratorSpec[]
  events: AgentCollaborationEvent[]
}

const ROLE_GUIDANCE: Record<AgentCollaboratorRole, string> = {
  researcher: 'Map facts and evidence. Prioritize file paths, APIs, data flow, and exact observations.',
  reviewer: 'Look for bugs, regressions, missing tests, security risks, and architectural mismatch. Be skeptical but evidence-based.',
  planner: 'Decompose the work into safe phases, dependencies, constraints, and verification steps.',
  tester: 'Focus on existing tests, missing coverage, edge cases, and the narrowest verification commands the main agent should run.',
  browser: 'Focus on browser-facing behavior, UI state, navigation, and user-visible flows. Do not invent page state.',
  implementer: 'Inspect how the change would be made, but do not edit. Report likely files, local patterns, and implementation risks.',
  generalist: 'Investigate the task broadly and return concise, grounded findings.'
}

export function normalizeCollaboratorInputs(
  rawTasks: Array<string | AgentCollaborationTaskInput>,
  maxCount: number
): AgentCollaboratorSpec[] {
  return rawTasks
    .map((raw): AgentCollaborationTaskInput => {
      if (typeof raw === 'string') return { task: raw }
      return raw
    })
    .map((raw) => ({
      task: String(raw.task ?? '').trim(),
      role: normalizeRole(raw.role),
      title: String(raw.title ?? '').trim()
    }))
    .filter((item) => item.task)
    .slice(0, maxCount)
    .map((item, index) => ({
      id: `agent-${index + 1}`,
      role: item.role,
      title: item.title || defaultTitle(item.role, index),
      task: item.task,
      status: 'queued' as const
    }))
}

export function roleSystemPrompt(role: AgentCollaboratorRole): string {
  return [
    `Role: ${role}.`,
    ROLE_GUIDANCE[role],
    'Work as a subordinate specialist in a main-agent led collaboration.',
    'Return a concise report with sections: Findings, Evidence, Risks, Suggested next steps.',
    'Use concrete file paths and code references when available. Do not write files, run shell commands, or perform side effects.'
  ].join('\n')
}

export function createCollaborationRun(collaborators: AgentCollaboratorSpec[]): AgentCollaborationRun {
  const runId = randomUUID()
  const startedAt = Date.now()
  const events = collaborators.map((agent) =>
    createCollaborationEvent(runId, agent, 'assigned', `${agent.title}: ${agent.task}`)
  )
  return {
    runId,
    mode: 'read_only_workspace',
    startedAt,
    collaborators,
    events
  }
}

export function createCollaborationEvent(
  runId: string,
  collaborator: Pick<AgentCollaboratorSpec, 'id' | 'role'>,
  type: AgentCollaborationEventType,
  message: string
): AgentCollaborationEvent {
  return {
    id: randomUUID(),
    runId,
    collaboratorId: collaborator.id,
    role: collaborator.role,
    type,
    message,
    createdAt: Date.now()
  }
}

export function updateCollaboratorStatus(
  collaborators: AgentCollaboratorSpec[],
  id: string,
  status: AgentCollaboratorSpec['status']
): void {
  const collaborator = collaborators.find((item) => item.id === id)
  if (collaborator) collaborator.status = status
}

function normalizeRole(role: unknown): AgentCollaboratorRole {
  const value = String(role ?? '').trim().toLowerCase()
  if (isCollaboratorRole(value)) return value
  return 'generalist'
}

function isCollaboratorRole(value: string): value is AgentCollaboratorRole {
  return ['researcher', 'reviewer', 'planner', 'tester', 'browser', 'implementer', 'generalist'].includes(value)
}

function defaultTitle(role: AgentCollaboratorRole, index: number): string {
  const label: Record<AgentCollaboratorRole, string> = {
    researcher: 'Research agent',
    reviewer: 'Review agent',
    planner: 'Planning agent',
    tester: 'Test agent',
    browser: 'Browser agent',
    implementer: 'Implementation scout',
    generalist: 'General agent'
  }
  return `${label[role]} ${index + 1}`
}
