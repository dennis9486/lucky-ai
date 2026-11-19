import type { LegacyConversationImport } from '../../shared/types/conversation.js'
import {
  loadActiveProjectId,
  loadApprovalMode,
  loadProjects,
  loadStartupMode
} from './project-storage.js'
import { loadActiveSessionId, loadSessions } from './session-storage.js'

export function readLegacyConversationData(): LegacyConversationImport | null {
  const sessions = loadSessions()
  const projects = loadProjects()
  const hasData =
    sessions.length > 0 ||
    projects.length > 0 ||
    loadActiveSessionId() !== null ||
    loadActiveProjectId() !== null

  if (!hasData) return null

  return {
    sessions,
    activeSessionId: loadActiveSessionId(),
    projects,
    activeProjectId: loadActiveProjectId(),
    startupMode: loadStartupMode(),
    approvalMode: loadApprovalMode()
  }
}

export function clearLegacyConversationStorage(): void {
  localStorage.removeItem('lucky-ai:sessions')
  localStorage.removeItem('lucky-ai:active-session')
  localStorage.removeItem('lucky-ai:projects')
  localStorage.removeItem('lucky-ai:active-project')
  localStorage.removeItem('lucky-ai:startup-mode')
  localStorage.removeItem('lucky-ai:approval-mode')
}
