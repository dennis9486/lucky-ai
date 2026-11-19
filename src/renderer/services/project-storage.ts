import type { ProjectEntry } from '../../shared/types/project.js'

const PROJECTS_KEY = 'lucky-ai:projects'
const ACTIVE_PROJECT_KEY = 'lucky-ai:active-project'
const STARTUP_MODE_KEY = 'lucky-ai:startup-mode'
const APPROVAL_MODE_KEY = 'lucky-ai:approval-mode'

export function loadProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ProjectEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p) => typeof p.rootPath === 'string' && p.rootPath.length > 0)
  } catch {
    return []
  }
}

export function saveProjects(projects: ProjectEntry[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

export function loadActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_PROJECT_KEY)
}

export function saveActiveProjectId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id)
  else localStorage.removeItem(ACTIVE_PROJECT_KEY)
}

export function loadStartupMode(): 'local' | 'worktree' {
  const mode = localStorage.getItem(STARTUP_MODE_KEY)
  return mode === 'worktree' ? 'worktree' : 'local'
}

export function saveStartupMode(mode: 'local' | 'worktree'): void {
  localStorage.setItem(STARTUP_MODE_KEY, mode)
}

export type StoredApprovalMode = 'ask' | 'auto' | 'full'

export function loadApprovalMode(): StoredApprovalMode {
  const mode = localStorage.getItem(APPROVAL_MODE_KEY)
  if (mode === 'auto' || mode === 'full') return mode
  return 'ask'
}

export function saveApprovalMode(mode: StoredApprovalMode): void {
  localStorage.setItem(APPROVAL_MODE_KEY, mode)
}
