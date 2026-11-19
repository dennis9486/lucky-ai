import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type AppView = 'home' | 'chat' | 'code' | 'workspace' | 'browser' | 'scheduled'
export type CommandPaletteMode = 'files' | 'sessions'
export type CodeSidebarTab = 'files' | 'search' | 'git' | 'problems' | 'extensions'
export type AppDialogKind = 'alert' | 'confirm' | 'prompt'

export interface AppDialogOptions {
  kind: AppDialogKind
  title?: string
  message: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface AppDialogState extends AppDialogOptions {
  id: number
}

export interface AppDialogResult {
  confirmed: boolean
  value?: string
}

export interface ComposerAttachment {
  path: string
  name: string
  kind: 'file' | 'folder' | 'image'
  mimeType?: string
  previewUrl?: string
}

export type ComposerAttachmentInput =
  | string
  | {
      path: string
      name?: string
      kind?: ComposerAttachment['kind']
      mimeType?: string
      previewUrl?: string
    }

import { isImagePath } from '../utils/mention.js'

const SIDEBAR_WIDTH_KEY = 'lucky-ai.sidebarWidth'
const CODE_AGENT_WIDTH_KEY = 'lucky-ai.codeAgentWidth'
const PRIMARY_VIEW_KEY = 'lucky-ai.primaryView'
export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_DEFAULT_WIDTH = 280
export const SIDEBAR_MAX_WIDTH = 520
export const CODE_AGENT_MIN_WIDTH = 280
export const CODE_AGENT_DEFAULT_WIDTH = 360
export const CODE_AGENT_MAX_WIDTH = 620

export const useUiStore = defineStore('ui', () => {
  const currentView = ref<AppView>(readPrimaryView())
  const showCommandPalette = ref(false)
  const commandPaletteMode = ref<CommandPaletteMode>('files')
  const chatInputFocused = ref(false)
  const sidebarCollapsed = ref(false)
  // 原生全屏时 macOS 隐藏红绿灯，为其预留的 72px 变成空白，据此调整/隐藏标题栏。
  // 以主进程 enter/leave-full-screen 事件为权威来源（比 display-mode 媒体查询可靠）。
  const isFullscreen = ref(false)
  if (typeof window !== 'undefined') {
    window.luckyAI?.app?.onFullscreenChanged?.((fullscreen: boolean) => { isFullscreen.value = fullscreen })
  }
  const rightPanelVisible = ref(false)
  const codeAgentVisible = ref(true)
  const codeSidebarTab = ref<CodeSidebarTab>('files')
  const planMode = ref(false)
  const showGoalInput = ref(false)
  const showLogoutConfirm = ref(false)
  const attachedRuntime = ref<'electron' | null>(null)
  const composerAttachments = ref<ComposerAttachment[]>([])
  const imageViewerAttachments = ref<ComposerAttachment[]>([])
  const activeImageAttachmentPath = ref<string | null>(null)
  const appDialog = ref<AppDialogState | null>(null)
  const sidebarWidth = ref(readSidebarWidth())
  const codeAgentWidth = ref(readCodeAgentWidth())
  let dialogId = 0
  let dialogResolve: ((result: AppDialogResult) => void) | null = null

  watch(currentView, (view) => {
    if (view === 'code') {
      savePrimaryView('code')
    } else if (view === 'home' || view === 'chat') {
      savePrimaryView('chat')
    }
  })

  function addComposerAttachments(items: ComposerAttachmentInput[]): void {
    const next = items.map(normalizeAttachment)
    const merged = new Map(composerAttachments.value.map((item) => [item.path, item]))
    for (const item of next) merged.set(item.path, item)
    composerAttachments.value = [...merged.values()]
  }

  function removeComposerAttachment(path: string): void {
    const removed = composerAttachments.value.find((item) => item.path === path)
    revokePreviewUrl(removed?.previewUrl)
    composerAttachments.value = composerAttachments.value.filter((item) => item.path !== path)
    if (activeImageAttachmentPath.value === path) {
      activeImageAttachmentPath.value = composerAttachments.value.find((item) => item.kind === 'image')?.path ?? null
    }
  }

  function clearComposerAttachments(): void {
    for (const item of composerAttachments.value) revokePreviewUrl(item.previewUrl)
    composerAttachments.value = []
    activeImageAttachmentPath.value = null
  }

  function toggleRightPanel(): void {
    rightPanelVisible.value = !rightPanelVisible.value
  }

  function toggleCodeAgentPanel(): void {
    codeAgentVisible.value = !codeAgentVisible.value
  }

  function openImageAttachment(path: string, items?: ComposerAttachmentInput[]): void {
    imageViewerAttachments.value = items?.map(normalizeAttachment).filter((item) => item.kind === 'image') ?? []
    const source = imageViewerAttachments.value.length ? imageViewerAttachments.value : composerAttachments.value
    if (source.some((item) => item.kind === 'image' && item.path === path)) {
      activeImageAttachmentPath.value = path
    }
  }

  function closeImageAttachmentViewer(): void {
    activeImageAttachmentPath.value = null
    imageViewerAttachments.value = []
  }

  function openDialog(options: AppDialogOptions): Promise<AppDialogResult> {
    dialogResolve?.({ confirmed: false })
    return new Promise((resolve) => {
      dialogResolve = resolve
      appDialog.value = { ...options, id: ++dialogId }
    })
  }

  async function alert(message: string, title?: string): Promise<void> {
    await openDialog({ kind: 'alert', title, message })
  }

  async function confirm(message: string, options: Omit<AppDialogOptions, 'kind' | 'message'> = {}): Promise<boolean> {
    const result = await openDialog({ ...options, kind: 'confirm', message })
    return result.confirmed
  }

  async function prompt(message: string, options: Omit<AppDialogOptions, 'kind' | 'message'> = {}): Promise<string | null> {
    const result = await openDialog({ ...options, kind: 'prompt', message })
    return result.confirmed ? result.value ?? '' : null
  }

  function resolveDialog(result: AppDialogResult): void {
    const resolve = dialogResolve
    dialogResolve = null
    appDialog.value = null
    resolve?.(result)
  }

  function setSidebarWidth(width: number): void {
    const max = typeof window === 'undefined'
      ? SIDEBAR_MAX_WIDTH
      : Math.min(SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.5))
    sidebarWidth.value = Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), max)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
  }

  function setCodeAgentWidth(width: number): void {
    const max = typeof window === 'undefined'
      ? CODE_AGENT_MAX_WIDTH
      : Math.min(CODE_AGENT_MAX_WIDTH, Math.floor(window.innerWidth * 0.55))
    codeAgentWidth.value = Math.min(Math.max(Math.round(width), CODE_AGENT_MIN_WIDTH), max)
    localStorage.setItem(CODE_AGENT_WIDTH_KEY, String(codeAgentWidth.value))
  }

  return {
    currentView,
    showCommandPalette,
    commandPaletteMode,
    chatInputFocused,
    sidebarCollapsed,
    isFullscreen,
    rightPanelVisible,
    codeAgentVisible,
    codeSidebarTab,
    planMode,
    showGoalInput,
    showLogoutConfirm,
    attachedRuntime,
    composerAttachments,
    imageViewerAttachments,
    activeImageAttachmentPath,
    appDialog,
    sidebarWidth,
    codeAgentWidth,
    addComposerAttachments,
    removeComposerAttachment,
    clearComposerAttachments,
    toggleRightPanel,
    toggleCodeAgentPanel,
    openImageAttachment,
    closeImageAttachmentViewer,
    openDialog,
    alert,
    confirm,
    prompt,
    resolveDialog,
    setSidebarWidth,
    setCodeAgentWidth
  }
})

function readSidebarWidth(): number {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDEBAR_WIDTH_KEY)
  const parsed = raw ? Number(raw) : SIDEBAR_DEFAULT_WIDTH
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(Math.max(parsed, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)
}

function readCodeAgentWidth(): number {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CODE_AGENT_WIDTH_KEY)
  const parsed = raw ? Number(raw) : CODE_AGENT_DEFAULT_WIDTH
  if (!Number.isFinite(parsed)) return CODE_AGENT_DEFAULT_WIDTH
  return Math.min(Math.max(parsed, CODE_AGENT_MIN_WIDTH), CODE_AGENT_MAX_WIDTH)
}

function readPrimaryView(): AppView {
  if (typeof localStorage === 'undefined') return 'home'
  return localStorage.getItem(PRIMARY_VIEW_KEY) === 'code' ? 'code' : 'home'
}

function savePrimaryView(view: 'chat' | 'code'): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PRIMARY_VIEW_KEY, view)
}

function normalizeAttachment(input: ComposerAttachmentInput): ComposerAttachment {
  if (typeof input === 'string') {
    return {
      path: input,
      name: input.split(/[/\\]/).filter(Boolean).pop() ?? input,
      kind: isImagePath(input) ? 'image' : input.includes('.') ? 'file' : 'folder'
    }
  }
  return {
    path: input.path,
    name: input.name ?? input.path.split(/[/\\]/).filter(Boolean).pop() ?? input.path,
    kind: input.kind ?? (isImagePath(input.path) ? 'image' : input.path.includes('.') ? 'file' : 'folder'),
    mimeType: input.mimeType,
    previewUrl: input.previewUrl
  }
}

function revokePreviewUrl(url?: string): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}
