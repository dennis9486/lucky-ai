import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { EditorWorkspaceState, OpenFileTab } from '../../shared/types/workspace.js'
import type { FileReadResult } from '../../shared/types/ipc.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import {
  applyAcceptedDiffHunk,
  applyRejectedDiffHunk,
  buildDiffHunks,
  type DiffHunk
} from '../utils/editor-diff.js'
import { getMonacoPaneForPath } from '../services/monaco-runtime.registry.js'
import { isTabDirty } from '../utils/editor-tab-dirty.js'
import { useSettingsStore } from './settings.store.js'
import { createLogger } from '../../shared/utils/log.js'

export type { DiffHunk }

const logger = createLogger('renderer/editor-store')

export const useEditorStore = defineStore('editor', () => {
  const tabs = ref<OpenFileTab[]>([])
  const activeTabPath = ref<string | null>(null)
  const showDiff = ref(false)
  const diffOriginal = ref('')
  const diffModified = ref('')
  const diffPath = ref('')
  const diffTitle = ref('')
  const diffReadOnly = ref(false)
  const diffInline = ref(false)
  const acceptedDiffHunkIds = ref<string[]>([])
  const revealTarget = ref<{ path: string; lineNumber: number; column: number; endColumn?: number } | null>(null)
  const splitEnabled = ref(false)
  const secondaryTabPath = ref<string | null>(null)
  const focusedPane = ref<'primary' | 'secondary'>('primary')
  const splitRatio = ref(0.5)
  const showConflict = ref(false)
  /** 在编辑器区展示某扩展详情页（覆盖式，与 diff/conflict 同级；null 表示不展示） */
  const activeExtensionId = ref<string | null>(null)
  const conflictPath = ref('')
  const conflictWorking = ref('')
  const conflictBase = ref('')
  const conflictOurs = ref('')
  const conflictTheirs = ref('')
  let workspaceRootPath: string | null = null
  let isRestoringWorkspace = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const activeTab = computed(() => tabs.value.find((t) => t.path === activeTabPath.value) ?? null)
  const secondaryTab = computed(() =>
    secondaryTabPath.value ? tabs.value.find((t) => t.path === secondaryTabPath.value) ?? null : null
  )
  const diffHunks = computed(() => buildDiffHunks(diffOriginal.value, diffModified.value))

  function clearTransientViews(): void {
    showDiff.value = false
    acceptedDiffHunkIds.value = []
    showConflict.value = false
    activeExtensionId.value = null
  }

  /** 打开扩展详情页（覆盖式展示，不改动已打开的文件标签）。 */
  function openExtensionDetail(extensionId: string): void {
    clearTransientViews()
    activeExtensionId.value = extensionId
  }

  function closeExtensionDetail(): void {
    activeExtensionId.value = null
  }

  function getTabName(path: string): string {
    return path.split('/').pop() ?? path
  }

  function getTabLanguage(path: string): string {
    const name = getTabName(path)
    const parts = name.split('.')
    return parts.length > 1 ? parts.at(-1) ?? '' : ''
  }

  function buildTab(path: string, content: string): OpenFileTab {
    return {
      path,
      name: getTabName(path),
      content,
      originalContent: content,
      language: getTabLanguage(path),
      pristineVersionId: null,
      isDirty: false
    }
  }

  function buildWorkspaceState(): EditorWorkspaceState {
    return {
      version: 1,
      tabs: tabs.value.map((tab) => ({ path: tab.path })),
      activeTabPath: activeTabPath.value,
      splitEnabled: splitEnabled.value,
      secondaryTabPath: secondaryTabPath.value,
      splitRatio: splitRatio.value,
      updatedAt: Date.now()
    }
  }

  async function flushWorkspaceState(): Promise<void> {
    if (!workspaceRootPath || isRestoringWorkspace) return
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    await unwrap(ipc.workspace.setEditorState(buildWorkspaceState(), workspaceRootPath))
  }

  function scheduleWorkspaceStatePersist(): void {
    if (!workspaceRootPath || isRestoringWorkspace) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void flushWorkspaceState().catch((error) => {
        logger.warn('failed to persist workspace state', { error, workspaceRootPath })
      })
    }, 250)
  }

  async function restoreWorkspaceState(rootPath: string): Promise<void> {
    await flushWorkspaceState().catch((error) => {
      logger.warn('failed to persist previous workspace state', { error, rootPath })
    })
    workspaceRootPath = rootPath
    isRestoringWorkspace = true
    clearTransientViews()
    tabs.value = []
    activeTabPath.value = null
    secondaryTabPath.value = null
    splitEnabled.value = false
    focusedPane.value = 'primary'

    try {
      let state: EditorWorkspaceState | null = null
      try {
        state = await unwrap<EditorWorkspaceState | null>(ipc.workspace.getEditorState(rootPath))
      } catch (error) {
        logger.warn('failed to restore workspace state', { error, rootPath })
      }
      const restoredTabs: OpenFileTab[] = []
      for (const tabState of state?.tabs ?? []) {
        try {
          const result = await unwrap<FileReadResult>(ipc.file.read(tabState.path))
          restoredTabs.push(buildTab(tabState.path, result.content))
        } catch (error) {
          logger.info('skipped stale restored tab', { path: tabState.path, error })
        }
      }

      tabs.value = restoredTabs
      activeTabPath.value = restoredTabs.some((tab) => tab.path === state?.activeTabPath)
        ? state?.activeTabPath ?? null
        : restoredTabs[0]?.path ?? null

      const secondaryPath = state?.secondaryTabPath ?? null
      secondaryTabPath.value = secondaryPath && restoredTabs.some((tab) => tab.path === secondaryPath)
        ? secondaryPath
        : null
      splitEnabled.value = Boolean(state?.splitEnabled && secondaryTabPath.value)
      splitRatio.value = typeof state?.splitRatio === 'number'
        ? Math.min(0.8, Math.max(0.2, state.splitRatio))
        : 0.5
    } finally {
      isRestoringWorkspace = false
      scheduleWorkspaceStatePersist()
    }
  }

  function clearWorkspaceState(): void {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    workspaceRootPath = null
    isRestoringWorkspace = true
    clearTransientViews()
    tabs.value = []
    activeTabPath.value = null
    secondaryTabPath.value = null
    splitEnabled.value = false
    focusedPane.value = 'primary'
    isRestoringWorkspace = false
  }

  function selectTab(path: string): void {
    if (!tabs.value.some((tab) => tab.path === path)) return
    clearTransientViews()
    activeTabPath.value = path
    focusedPane.value = 'primary'
  }

  async function openFile(path: string, reveal?: { lineNumber: number; column?: number; endColumn?: number }): Promise<void> {
    const settings = useSettingsStore()
    if (settings.editor.fileOpenTarget === 'vscode') {
      const line = reveal?.lineNumber ? `:${reveal.lineNumber}${reveal.column ? `:${reveal.column}` : ''}` : ''
      await unwrap(ipc.app.openExternal(`vscode://file/${encodeURI(path)}${line}`))
      return
    }

    const existing = tabs.value.find((t) => t.path === path)
    if (existing) {
      selectTab(path)
      setRevealTarget(path, reveal)
      return
    }

    const result = await unwrap<FileReadResult>(ipc.file.read(path))
    tabs.value.push(buildTab(path, result.content))
    selectTab(path)
    setRevealTarget(path, reveal)
  }

  function closeTab(path: string): void {
    const idx = tabs.value.findIndex((t) => t.path === path)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    if (secondaryTabPath.value === path) {
      secondaryTabPath.value = null
      splitEnabled.value = false
      focusedPane.value = 'primary'
    }
    if (activeTabPath.value === path) {
      activeTabPath.value = tabs.value[Math.min(idx, tabs.value.length - 1)]?.path ?? null
    }
  }

  function closeTabs(paths: string[]): void {
    const pathSet = new Set(paths)
    if (!pathSet.size) return
    const activePath = activeTabPath.value
    tabs.value = tabs.value.filter((tab) => !pathSet.has(tab.path))
    if (secondaryTabPath.value && pathSet.has(secondaryTabPath.value)) {
      secondaryTabPath.value = null
      splitEnabled.value = false
      focusedPane.value = 'primary'
    }
    if (activePath && !tabs.value.some((tab) => tab.path === activePath)) {
      activeTabPath.value = tabs.value.at(-1)?.path ?? null
    }
  }

  function closeOtherTabs(path: string): void {
    const target = tabs.value.find((tab) => tab.path === path)
    if (!target) return
    tabs.value = [target]
    activeTabPath.value = target.path
    if (secondaryTabPath.value !== target.path) {
      secondaryTabPath.value = null
      splitEnabled.value = false
      focusedPane.value = 'primary'
    }
  }

  function closeTabsToRight(path: string): void {
    const idx = tabs.value.findIndex((tab) => tab.path === path)
    if (idx === -1) return
    tabs.value = tabs.value.slice(0, idx + 1)
    if (secondaryTabPath.value && !tabs.value.some((tab) => tab.path === secondaryTabPath.value)) {
      secondaryTabPath.value = null
      splitEnabled.value = false
      focusedPane.value = 'primary'
    }
    if (!tabs.value.some((tab) => tab.path === activeTabPath.value)) {
      activeTabPath.value = tabs.value.at(-1)?.path ?? null
    }
  }

  function closeSavedTabs(): void {
    const activeDirtyTab = tabs.value.find((tab) => tab.path === activeTabPath.value && tab.isDirty)
    tabs.value = tabs.value.filter((tab) => tab.isDirty)
    activeTabPath.value = activeDirtyTab?.path ?? tabs.value[0]?.path ?? null
    if (secondaryTabPath.value && !tabs.value.some((tab) => tab.path === secondaryTabPath.value)) {
      secondaryTabPath.value = null
      splitEnabled.value = false
      focusedPane.value = 'primary'
    }
  }

  function closeAllTabs(): void {
    tabs.value = []
    activeTabPath.value = null
    secondaryTabPath.value = null
    splitEnabled.value = false
    focusedPane.value = 'primary'
  }

  function syncTabBuffer(path: string, content: string, versionId: number): void {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    tab.content = content
    tab.isDirty = isTabDirty(tab.pristineVersionId, versionId)
  }

  /** Capture the current model version as the clean baseline (open / save / reload). */
  function commitTabPristine(path: string, content: string, versionId: number): void {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    tab.content = content
    tab.originalContent = content
    tab.pristineVersionId = versionId
    tab.isDirty = false
  }

  /** Explicit programmatic edits (diff accept, conflict resolve, etc.). */
  function updateContent(path: string, content: string): void {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    tab.content = content
    tab.isDirty = true
  }

  async function saveFile(path?: string): Promise<void> {
    const targetPath = path ?? activeTabPath.value
    if (!targetPath) return
    const tab = tabs.value.find((t) => t.path === targetPath)
    if (!tab) return
    await unwrap(ipc.file.write(targetPath, tab.content))
    const model = getMonacoPaneForPath(targetPath)?.editor.getModel()
    if (model) {
      commitTabPristine(targetPath, tab.content, model.getAlternativeVersionId())
      return
    }
    tab.originalContent = tab.content
    tab.pristineVersionId = null
    tab.isDirty = false
  }

  async function reloadFiles(paths: string[]): Promise<void> {
    const pathSet = new Set(paths)
    await Promise.all(tabs.value
      .filter((tab) => pathSet.has(tab.path) && !tab.isDirty)
      .map(async (tab) => {
        const result = await unwrap<FileReadResult>(ipc.file.read(tab.path))
        tab.content = result.content
        tab.originalContent = result.content
        tab.pristineVersionId = null
      }))
  }

  function showDiffView(
    path: string,
    original: string,
    modified: string,
    options?: { title?: string; readOnly?: boolean; inline?: boolean }
  ): void {
    diffPath.value = path
    diffTitle.value = options?.title ?? path
    diffOriginal.value = original
    diffModified.value = modified
    diffReadOnly.value = Boolean(options?.readOnly)
    diffInline.value = Boolean(options?.inline)
    acceptedDiffHunkIds.value = []
    showDiff.value = true
  }

  function acceptDiff(): void {
    if (diffPath.value) {
      updateContent(diffPath.value, diffModified.value)
    }
    acceptedDiffHunkIds.value = []
    showDiff.value = false
  }

  function rejectDiff(): void {
    acceptedDiffHunkIds.value = []
    showDiff.value = false
  }

  function closeDiff(): void {
    acceptedDiffHunkIds.value = []
    showDiff.value = false
  }

  function acceptDiffHunk(index: number): void {
    const hunk = diffHunks.value[index]
    if (!hunk) return
    diffOriginal.value = applyAcceptedDiffHunk(diffOriginal.value, diffModified.value, hunk)
    acceptedDiffHunkIds.value = acceptedDiffHunkIds.value.filter((id) => id !== hunk.id)
  }

  function rejectDiffHunk(index: number): void {
    const hunk = diffHunks.value[index]
    if (!hunk) return
    diffModified.value = applyRejectedDiffHunk(diffOriginal.value, diffModified.value, hunk)
    acceptedDiffHunkIds.value = acceptedDiffHunkIds.value.filter((id) => id !== hunk.id)
  }

  function isDiffHunkAccepted(hunk: DiffHunk): boolean {
    return acceptedDiffHunkIds.value.includes(hunk.id)
  }

  function consumeRevealTarget(path: string): typeof revealTarget.value {
    if (!revealTarget.value || revealTarget.value.path !== path) return null
    const target = revealTarget.value
    revealTarget.value = null
    return target
  }

  function setRevealTarget(path: string, reveal?: { lineNumber: number; column?: number; endColumn?: number }): void {
    if (!reveal) return
    revealTarget.value = {
      path,
      lineNumber: reveal.lineNumber,
      column: reveal.column ?? 1,
      endColumn: reveal.endColumn
    }
  }

  async function openToSide(path: string): Promise<void> {
    await openFile(path)
    if (!splitEnabled.value) {
      splitEnabled.value = true
      secondaryTabPath.value = path
      focusedPane.value = 'secondary'
      return
    }
    secondaryTabPath.value = path
    focusedPane.value = 'secondary'
  }

  function closeSplit(): void {
    splitEnabled.value = false
    secondaryTabPath.value = null
    focusedPane.value = 'primary'
  }

  function showConflictView(payload: {
    path: string
    working: string
    base: string
    ours: string
    theirs: string
  }): void {
    showConflict.value = true
    showDiff.value = false
    conflictPath.value = payload.path
    conflictWorking.value = payload.working
    conflictBase.value = payload.base
    conflictOurs.value = payload.ours
    conflictTheirs.value = payload.theirs
  }

  function updateConflictWorking(content: string): void {
    conflictWorking.value = content
    updateContent(conflictPath.value, content)
  }

  function closeConflict(): void {
    showConflict.value = false
    conflictPath.value = ''
    conflictWorking.value = ''
    conflictBase.value = ''
    conflictOurs.value = ''
    conflictTheirs.value = ''
  }

  function focusPane(pane: 'primary' | 'secondary'): void {
    focusedPane.value = pane
    if (pane === 'primary' && activeTabPath.value) return
    if (pane === 'secondary' && secondaryTabPath.value) {
      selectTab(secondaryTabPath.value)
      focusedPane.value = 'secondary'
    }
  }

  watch(
    () => ({
      paths: tabs.value.map((tab) => tab.path),
      activeTabPath: activeTabPath.value,
      splitEnabled: splitEnabled.value,
      secondaryTabPath: secondaryTabPath.value,
      splitRatio: splitRatio.value
    }),
    scheduleWorkspaceStatePersist,
    { deep: true }
  )

  return {
    tabs, activeTabPath, activeTab, secondaryTab, revealTarget, showDiff, diffOriginal, diffModified, diffPath, diffTitle, diffReadOnly, diffInline,
    diffHunks, splitEnabled, secondaryTabPath, focusedPane, splitRatio,
    showConflict, conflictPath, conflictWorking, conflictBase, conflictOurs, conflictTheirs,
    activeExtensionId, openExtensionDetail, closeExtensionDetail,
    openFile, selectTab, closeTab, closeTabs, closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs,
    updateContent, syncTabBuffer, commitTabPristine, saveFile, reloadFiles, showDiffView, acceptDiff, rejectDiff, closeDiff,
    acceptDiffHunk, rejectDiffHunk, isDiffHunkAccepted,
    consumeRevealTarget, openToSide, closeSplit, focusPane,
    showConflictView, updateConflictWorking, closeConflict,
    restoreWorkspaceState, flushWorkspaceState, clearWorkspaceState
  }
})
