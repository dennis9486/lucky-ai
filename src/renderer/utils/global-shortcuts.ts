import {
  cloneBindings,
  eventMatchesShortcut,
  DEFAULT_KEYBOARD_SHORTCUT_SETTINGS,
  KEYBOARD_SHORTCUTS,
  type ShortcutBinding,
  type ShortcutDefinition
} from '../../shared/types/shortcuts.js'
import type { AppMenuCommand } from '../../shared/types/menu.js'
import { useUiStore } from '../stores/ui.store.js'
import { useSettingsStore } from '../stores/settings.store.js'
import { useChatStore } from '../stores/chat.store.js'
import { useSessionStore } from '../stores/session.store.js'
import { useTerminalStore } from '../stores/terminal.store.js'
import { useProjectStore } from '../stores/project.store.js'
import { useEditorStore } from '../stores/editor.store.js'
import { useCodeAgentStore } from '../stores/code-agent.store.js'
import { ipc, unwrap } from '../services/ipc-client.js'

function stopRunningAgents(): void {
  const chat = useChatStore()
  const agent = useCodeAgentStore()
  if (chat.isRunning) chat.stopAgent()
  if (agent.isRunning) agent.stop()
}

function focusComposer(): void {
  const ui = useUiStore()
  ui.chatInputFocused = true
  document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus()
}

async function startNewChat(): Promise<void> {
  const chat = useChatStore()
  const sessions = useSessionStore()
  const ui = useUiStore()
  const settings = useSettingsStore()
  chat.abortIfRunning()
  await sessions.newChat()
  chat.clearInput()
  ui.currentView = settings.general.defaultNoProjectChat ? 'chat' : 'home'
}

async function startQuickChat(): Promise<void> {
  await startNewChat()
  focusComposer()
}

async function archiveActiveChat(): Promise<void> {
  const chat = useChatStore()
  const sessions = useSessionStore()
  const ui = useUiStore()
  const id = sessions.activeSessionId
  if (!id) return

  chat.abortIfRunning()
  await sessions.archiveSession(id)

  const next = sessions.activeSession
  ui.currentView = next && next.messages.length > 0 ? 'chat' : 'home'
}

function toggleSidebar(): void {
  const ui = useUiStore()
  ui.sidebarCollapsed = !ui.sidebarCollapsed
}

async function openNewWindow(): Promise<void> {
  await unwrap(ipc.app.createWindow())
}

async function toggleTerminal(): Promise<void> {
  const projects = useProjectStore()
  const terminal = useTerminalStore()
  const ready = await projects.ensureWorkspace()
  if (ready) await terminal.toggle()
}

async function saveCurrentFile(): Promise<void> {
  const editor = useEditorStore()
  if (!editor.activeTab || editor.showDiff) return
  await editor.saveFile(editor.activeTab.path)
}

type ShortcutHandler = () => void | Promise<void>

const SHORTCUT_HANDLERS: Record<string, ShortcutHandler> = {
  'new-chat': startNewChat,
  'save-current-file': saveCurrentFile,
  'command-palette': () => {
    useUiStore().showCommandPalette = true
  },
  'focus-composer': focusComposer,
  'open-settings': () => {
    useSettingsStore().showSettings = true
  },
  'stop-agent': stopRunningAgents,
  'archive-chat': archiveActiveChat,
  'side-chat': toggleSidebar,
  'toggle-sidebar': toggleSidebar,
  'toggle-terminal': toggleTerminal,
  'toggle-right-panel': () => {
    useUiStore().toggleRightPanel()
  },
  'show-chat': () => {
    const sessions = useSessionStore()
    useUiStore().currentView = sessions.activeSession?.messages.length ? 'chat' : 'home'
  },
  'show-code': () => {
    const settings = useSettingsStore()
    if (!settings.professionalMode) {
      settings.showSettings = true
      return
    }
    useUiStore().currentView = 'code'
  },
  'show-browser': () => {
    useUiStore().currentView = 'browser'
  },
  'show-scheduled': () => {
    useUiStore().currentView = 'scheduled'
  },
  'new-window': openNewWindow,
  'quick-chat': startQuickChat
}

export async function runAppMenuCommand(command: AppMenuCommand): Promise<boolean> {
  const handler = SHORTCUT_HANDLERS[command]
  if (!handler) return false
  await handler()
  return true
}

function findMatchingShortcut(e: KeyboardEvent): ShortcutDefinition | null {
  const settings = useSettingsStore()
  for (const shortcut of KEYBOARD_SHORTCUTS) {
    const bindings = getShortcutBindings(shortcut.id, settings.keyboardShortcuts)
    if (shortcut.unassigned || !bindings.length) continue
    for (const binding of bindings) {
      if (eventMatchesShortcut(e, binding.match)) {
        return shortcut
      }
    }
  }
  return null
}

function getShortcutBindings(id: string, settings: Record<string, ShortcutBinding[]>): ShortcutBinding[] {
  return cloneBindings(settings[id] ?? DEFAULT_KEYBOARD_SHORTCUT_SETTINGS[id] ?? [])
}

export async function handleGlobalShortcut(e: KeyboardEvent): Promise<boolean> {
  const ui = useUiStore()
  const settings = useSettingsStore()
  const chat = useChatStore()
  const agent = useCodeAgentStore()

  if (ui.showCommandPalette && e.key === 'Escape') return false
  if (settings.showSettings && e.key === 'Escape') return false

  if (e.key === 'Escape' && (chat.isRunning || agent.isRunning)) {
    e.preventDefault()
    stopRunningAgents()
    return true
  }

  if (getShortcutBindings('switch-chat', settings.keyboardShortcuts).some((binding) => eventMatchesShortcut(e, binding.match))) {
    const index = Number(e.key) - 1
    const item = useSessionStore().projectGroups[0]?.items[index]
    if (!item) return false
    e.preventDefault()
    chat.abortIfRunning()
    const session = await useSessionStore().selectSessionWithProject(item.id)
    if (session) {
      ui.currentView = session.messages.length > 0 ? 'chat' : 'home'
    }
    return true
  }

  const matched = findMatchingShortcut(e)
  if (!matched) return false

  e.preventDefault()
  const handler = SHORTCUT_HANDLERS[matched.id]
  if (handler) await handler()
  return true
}
