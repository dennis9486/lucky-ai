import type { ChatSession } from '../../shared/types/session.js'

const STORAGE_KEY = 'lucky-ai:sessions'
const ACTIVE_KEY = 'lucky-ai:active-session'

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function loadActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveSessionId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}
