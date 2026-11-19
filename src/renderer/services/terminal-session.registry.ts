import type { Terminal } from 'xterm'

export interface TerminalSessionHandle {
  sessionId: string
  clear: () => void
  scrollToPreviousCommand: () => boolean
  scrollToNextCommand: () => boolean
  getSelection: () => string
  focus: () => void
}

const handles = new Map<string, TerminalSessionHandle>()

export function registerTerminalSession(handle: TerminalSessionHandle): void {
  handles.set(handle.sessionId, handle)
}

export function unregisterTerminalSession(sessionId: string): void {
  handles.delete(sessionId)
}

export function getTerminalSession(sessionId: string): TerminalSessionHandle | null {
  return handles.get(sessionId) ?? null
}

export function getActiveTerminalSession(sessionId: string | null | undefined): TerminalSessionHandle | null {
  if (!sessionId) return null
  return getTerminalSession(sessionId)
}

export function attachTerminalShortcuts(term: Terminal, handle: Pick<TerminalSessionHandle, 'clear' | 'scrollToPreviousCommand' | 'scrollToNextCommand'>): void {
  term.attachCustomKeyEventHandler((event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return true
    if (event.type !== 'keydown') return true

    if (event.key === 'k' || event.key === 'K') {
      event.preventDefault()
      handle.clear()
      return false
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      handle.scrollToPreviousCommand()
      return false
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      handle.scrollToNextCommand()
      return false
    }

    return true
  })
}
