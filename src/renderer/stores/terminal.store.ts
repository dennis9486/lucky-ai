import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ipc, unwrap } from '../services/ipc-client.js'
import { extractCdTarget, normalizeCommandInput } from '../utils/terminal-command.js'

export interface TerminalTab {
  id: string
  sessionId: string
  title: string
  cwd?: string
}

export interface TerminalSplitLayout {
  panes: string[]
}

function equalPaneSizes(count: number): number[] {
  if (count <= 0) return []
  const size = 1 / count
  return Array.from({ length: count }, () => size)
}

function normalizePaneSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((total, size) => total + size, 0)
  if (sum <= 0) return equalPaneSizes(sizes.length)
  return sizes.map((size) => size / sum)
}

export type BottomPanelView = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

export interface OutputChannel {
  id: string
  name: string
  lines: string[]
}

export interface DebugConsoleEntry {
  id: string
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
  timestamp: number
}

const DEFAULT_HEIGHT = 260
const MIN_HEIGHT = 120
const MAX_HEIGHT_RATIO = 0.6
const SESSIONS_WIDTH_KEY = 'lucky-ai.terminalSessionsWidth'
const DEFAULT_SESSIONS_WIDTH = 168
const MIN_SESSIONS_WIDTH = 120
const MAX_SESSIONS_WIDTH = 360

function readSessionsSidebarWidth(): number {
  const raw = localStorage.getItem(SESSIONS_WIDTH_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return DEFAULT_SESSIONS_WIDTH
  return Math.min(Math.max(parsed, MIN_SESSIONS_WIDTH), MAX_SESSIONS_WIDTH)
}

export const useTerminalStore = defineStore('terminal', () => {
  const visible = ref(false)
  const panelHeight = ref(DEFAULT_HEIGHT)
  const activeView = ref<BottomPanelView>('terminal')
  const tabs = ref<TerminalTab[]>([])
  const activeTabId = ref<string | null>(null)
  const outputChannels = ref<OutputChannel[]>([
    { id: 'lucky', name: 'Lucky', lines: [] },
    { id: 'git', name: 'Git', lines: [] },
    { id: 'agent', name: 'Agent', lines: [] }
  ])
  const activeOutputChannelId = ref('lucky')
  const debugEntries = ref<DebugConsoleEntry[]>([])
  const recentDirectories = ref<string[]>([])
  const recentCommands = ref<string[]>([])
  const sessionsSidebarWidth = ref(readSessionsSidebarWidth())
  const splitLayout = ref<TerminalSplitLayout | null>(null)
  const splitPaneSizes = ref<number[]>([])

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)
  const activeOutputChannel = computed(() =>
    outputChannels.value.find((channel) => channel.id === activeOutputChannelId.value) ?? outputChannels.value[0] ?? null
  )

  function defaultShellTitle(): string {
    return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')
      ? 'powershell'
      : 'zsh'
  }

  function allocateTabTitle(explicitTitle: string | undefined, shellName: string): string {
    const base = explicitTitle?.trim() || shellName || defaultShellTitle()
    const existing = new Set(tabs.value.map((tab) => tab.title))
    if (!existing.has(base)) return base
    let index = 2
    while (existing.has(`${base} (${index})`)) index += 1
    return `${base} (${index})`
  }

  async function createTab(title?: string, cwd?: string): Promise<TerminalTab> {
    const result = await unwrap<{ id: string; shellName: string; cwd: string }>(ipc.terminal.create(cwd))
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      sessionId: result.id,
      title: allocateTabTitle(title, result.shellName),
      cwd: result.cwd
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    if (cwd) recordDirectory(cwd)
    return tab
  }

  async function ensureTab(): Promise<void> {
    if (tabs.value.length === 0) {
      await createTab()
    } else if (!activeTabId.value) {
      activeTabId.value = tabs.value[0]?.id ?? null
    }
  }

  async function show(view: BottomPanelView = 'terminal'): Promise<void> {
    visible.value = true
    activeView.value = view
    if (view === 'terminal') await ensureTab()
  }

  async function openAt(cwd: string, title?: string): Promise<void> {
    visible.value = true
    activeView.value = 'terminal'
    await createTab(title, cwd)
  }

  async function toggle(view: BottomPanelView = 'terminal'): Promise<void> {
    if (visible.value && activeView.value === view) {
      visible.value = false
    } else {
      await show(view)
    }
  }

  function setActiveView(view: BottomPanelView): void {
    activeView.value = view
    visible.value = true
    if (view === 'terminal') void ensureTab()
  }

  function appendOutput(channelId: string, line: string): void {
    const channel = outputChannels.value.find((item) => item.id === channelId)
    if (!channel) return
    channel.lines.push(line)
    if (channel.lines.length > 800) channel.lines.splice(0, channel.lines.length - 800)
  }

  function clearOutput(channelId?: string): void {
    if (channelId) {
      const channel = outputChannels.value.find((item) => item.id === channelId)
      if (channel) channel.lines = []
      return
    }
    for (const channel of outputChannels.value) channel.lines = []
  }

  function appendDebug(message: string, level: DebugConsoleEntry['level'] = 'log'): void {
    debugEntries.value.push({
      id: crypto.randomUUID(),
      level,
      message,
      timestamp: Date.now()
    })
    if (debugEntries.value.length > 400) debugEntries.value.splice(0, debugEntries.value.length - 400)
  }

  function clearDebug(): void {
    debugEntries.value = []
  }

  function recordDirectory(dir: string): void {
    const value = dir.trim()
    if (!value) return
    recentDirectories.value = [value, ...recentDirectories.value.filter((item) => item !== value)].slice(0, 12)
  }

  function recordCommand(command: string): void {
    const value = normalizeCommandInput(command)
    if (!value) return
    recentCommands.value = [value, ...recentCommands.value.filter((item) => item !== value)].slice(0, 20)
    const cdTarget = extractCdTarget(value)
    if (cdTarget) recordDirectory(cdTarget)
  }

  async function runInActiveSession(command: string): Promise<boolean> {
    if (!activeTab.value) await ensureTab()
    const sessionId = activeTab.value?.sessionId
    if (!sessionId) return false
    recordCommand(command)
    await write(sessionId, `${command}\r`)
    return true
  }

  async function changeDirectory(path: string): Promise<void> {
    recordDirectory(path)
    await runInActiveSession(`cd ${path.includes(' ') ? `'${path.replace(/'/g, `'\\''`)}'` : path}`)
  }

  function hide(): void {
    visible.value = false
  }

  async function addTab(title?: string, cwd?: string): Promise<void> {
    await createTab(title, cwd)
  }

  function resolveSplitPanes(): string[] {
    const layout = splitLayout.value
    if (!layout) return []
    return layout.panes.filter((paneId) => tabs.value.some((tab) => tab.id === paneId))
  }

  function syncSplitLayout(): void {
    const panes = resolveSplitPanes()
    if (panes.length < 2) {
      splitLayout.value = null
      splitPaneSizes.value = []
      return
    }
    splitLayout.value = { panes }
    if (splitPaneSizes.value.length !== panes.length) {
      splitPaneSizes.value = equalPaneSizes(panes.length)
    } else {
      splitPaneSizes.value = normalizePaneSizes(splitPaneSizes.value)
    }
  }

  async function closeTab(tabId: string): Promise<void> {
    const index = tabs.value.findIndex((t) => t.id === tabId)
    if (index < 0) return

    if (splitLayout.value?.panes.includes(tabId)) {
      const removeIndex = splitLayout.value.panes.indexOf(tabId)
      const nextPanes = splitLayout.value.panes.filter((paneId) => paneId !== tabId)
      const nextSizes = [...splitPaneSizes.value]
      if (removeIndex >= 0) nextSizes.splice(removeIndex, 1)
      splitLayout.value = nextPanes.length >= 2 ? { panes: nextPanes } : null
      splitPaneSizes.value =
        nextPanes.length >= 2 ? normalizePaneSizes(nextSizes) : []
    }

    const tab = tabs.value[index]
    if (tab) {
      await unwrap(ipc.terminal.kill(tab.sessionId))
    }
    tabs.value.splice(index, 1)

    if (tabs.value.length === 0) {
      activeTabId.value = null
      visible.value = false
      return
    }

    if (activeTabId.value === tabId) {
      const next = tabs.value[Math.min(index, tabs.value.length - 1)]
      activeTabId.value = next?.id ?? null
    }
  }

  async function closePanel(): Promise<void> {
    for (const tab of [...tabs.value]) {
      await unwrap(ipc.terminal.kill(tab.sessionId))
    }
    tabs.value = []
    activeTabId.value = null
    visible.value = false
  }

  function selectTab(tabId: string): void {
    activeTabId.value = tabId
    activeView.value = 'terminal'
    visible.value = true
    const panes = resolveSplitPanes()
    if (panes.length >= 2 && !panes.includes(tabId)) {
      splitLayout.value = null
      splitPaneSizes.value = []
    }
  }

  async function splitTab(tabId: string): Promise<void> {
    const source = tabs.value.find((tab) => tab.id === tabId)
    if (!source) return
    const newTab = await createTab(undefined, source.cwd)
    const layout = splitLayout.value
    const panes = layout ? resolveSplitPanes() : []

    if (panes.includes(tabId)) {
      const insertAt = panes.indexOf(tabId) + 1
      const nextPanes = [...panes]
      nextPanes.splice(insertAt, 0, newTab.id)
      splitLayout.value = { panes: nextPanes }
      splitPaneSizes.value = equalPaneSizes(nextPanes.length)
    } else {
      splitLayout.value = { panes: [tabId, newTab.id] }
      splitPaneSizes.value = equalPaneSizes(2)
    }

    activeTabId.value = tabId
    activeView.value = 'terminal'
    visible.value = true
  }

  function clearSplit(): void {
    splitLayout.value = null
    splitPaneSizes.value = []
  }

  function resizeSessionsSidebar(delta: number): void {
    sessionsSidebarWidth.value = Math.min(
      MAX_SESSIONS_WIDTH,
      Math.max(MIN_SESSIONS_WIDTH, sessionsSidebarWidth.value - delta)
    )
    localStorage.setItem(SESSIONS_WIDTH_KEY, String(sessionsSidebarWidth.value))
  }

  function resizeSplitPane(index: number, delta: number, containerWidth: number): void {
    if (containerWidth <= 0) return
    const sizes = splitPaneSizes.value
    if (index < 0 || index >= sizes.length - 1) return

    const minSize = 0.12
    const deltaRatio = delta / containerWidth
    const left = sizes[index]! + deltaRatio
    const right = sizes[index + 1]! - deltaRatio
    if (left < minSize || right < minSize) return

    const next = [...sizes]
    next[index] = left
    next[index + 1] = right
    splitPaneSizes.value = next
  }

  function isTabVisible(tabId: string): boolean {
    const panes = resolveSplitPanes()
    if (panes.length >= 2) {
      return panes.includes(tabId)
    }
    return tabId === activeTabId.value
  }

  function isTabFocused(tabId: string): boolean {
    return activeTabId.value === tabId
  }

  function resizePanel(delta: number): void {
    const max = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO)
    panelHeight.value = Math.min(max, Math.max(MIN_HEIGHT, panelHeight.value - delta))
  }

  async function write(sessionId: string, data: string): Promise<void> {
    await unwrap(ipc.terminal.write(sessionId, data))
  }

  async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await unwrap(ipc.terminal.resize(sessionId, cols, rows))
  }

  async function refreshOutput(sessionId?: string): Promise<string> {
    const result = await unwrap<{ id: string; output: string }>(ipc.terminal.getOutput(sessionId))
    return result.output
  }

  return {
    visible,
    panelHeight,
    activeView,
    tabs,
    activeTabId,
    activeTab,
    outputChannels,
    activeOutputChannelId,
    activeOutputChannel,
    debugEntries,
    recentDirectories,
    recentCommands,
    sessionsSidebarWidth,
    splitLayout,
    splitPaneSizes,
    resolveSplitPanes,
    syncSplitLayout,
    show,
    openAt,
    hide,
    toggle,
    setActiveView,
    addTab,
    closeTab,
    closePanel,
    selectTab,
    splitTab,
    clearSplit,
    resizeSessionsSidebar,
    resizeSplitPane,
    isTabVisible,
    isTabFocused,
    resizePanel,
    write,
    resize,
    refreshOutput,
    ensureTab,
    appendOutput,
    clearOutput,
    appendDebug,
    clearDebug,
    recordDirectory,
    recordCommand,
    runInActiveSession,
    changeDirectory
  }
})
