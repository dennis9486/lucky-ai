<script setup lang="ts">
import 'monaco-editor/min/vs/editor/editor.main.css'
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileCode2, X } from 'lucide-vue-next'
import type { OpenFileTab } from '../../../shared/types/workspace.js'
import EditorBreadcrumb from './EditorBreadcrumb.vue'
import EditorConflictView from './EditorConflictView.vue'
import EditorDiffView from './EditorDiffView.vue'
import EditorMonacoPane from './EditorMonacoPane.vue'
import EditorSaveChangesDialog from './EditorSaveChangesDialog.vue'
import EditorTabContextMenu from './EditorTabContextMenu.vue'
import ExtensionDetailView from '../code/ExtensionDetailView.vue'
import PackageJsonScriptsMenu from './PackageJsonScriptsMenu.vue'
import { useEditorStore } from '../../stores/editor.store.js'
import { getFileIcon } from '../../utils/file-icons.js'
import {
  configureWorkspaceLanguageServices,
  initializeMonacoHighlighting,
  loadMonaco,
} from '../../services/monaco.service.js'
import { registerFormatterProviders } from '../../services/formatter.service.js'
import {
  hydrateInlineCompletionStats,
  registerInlineCompletionProvider
} from '../../services/inline-completion.service.js'
import {
  bindMonacoForLsp,
  stopAllLanguageClients,
} from '../../services/lsp-client.service.js'
import { registerPackageJsonScriptSupport } from '../../services/package-json-codelens.service.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import {
  registerEditorAccess,
  unregisterEditorAccess
} from '../../services/editor-selection.registry.js'
import {
  notifyEditorStatus,
  unregisterEditorStatus
} from '../../services/editor-status.registry.js'
import { setInlineEditFocusedPane } from '../../services/ai-inline-edit.service.js'
import {
  openManualInlineEditComposer,
  setManualInlineEditFocusedPane
} from '../../services/manual-inline-edit.service.js'
import { activateExtensionHost } from '../../services/extension-host.service.js'
import { getMonacoHighlighter } from '../../services/monaco.service.js'

const { t } = useI18n()
const editor = useEditorStore()
const project = useProjectStore()
const settings = useSettingsStore()
const panelEl = ref<HTMLElement | null>(null)
const tabsEl = ref<HTMLElement | null>(null)
const primaryPaneRef = ref<InstanceType<typeof EditorMonacoPane> | null>(null)
const secondaryPaneRef = ref<InstanceType<typeof EditorMonacoPane> | null>(null)
const isEditorReady = ref(false)
const editorError = ref('')
const failedTabIcons = ref(new Set<string>())
const tabMenu = ref<{ tab: OpenFileTab; x: number; y: number } | null>(null)
const pendingClose = ref<{ paths: string[]; dirtyTabs: OpenFileTab[] } | null>(null)
const savingClose = ref(false)
const splitHostEl = ref<HTMLElement | null>(null)
const draggingSplit = ref(false)

const activeContent = computed(() => editor.activeTab?.content ?? '')
const activePath = computed(() => editor.activeTabPath)

function scrollActiveTabIntoView(): void {
  const container = tabsEl.value
  const path = editor.activeTabPath
  if (!container || !path) return

  const activeTab = container.querySelector<HTMLElement>(
    `.editor-tab[data-path="${CSS.escape(path)}"]`
  )
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

watch(activePath, () => {
  notifyEditorStatus()
  void nextTick(scrollActiveTabIntoView)
}, { immediate: true })

watch(() => editor.splitEnabled, (enabled) => {
  if (!enabled) editor.focusedPane = 'primary'
})

void ensureEditorServices()

async function ensureEditorServices(): Promise<void> {
  if (isEditorReady.value) return
  try {
    const monaco = await loadMonaco()
    bindMonacoForLsp(monaco)
    await initializeMonacoHighlighting(monaco)
    const highlighter = getMonacoHighlighter()
    if (highlighter) {
      await activateExtensionHost(monaco, highlighter, project.activeProject?.rootPath)
    }
    await configureWorkspaceLanguageServices(
      monaco,
      project.activeProject?.rootPath,
      Boolean(project.activeProject?.rootPath)
    )
    registerPackageJsonScriptSupport(monaco)
    hydrateInlineCompletionStats(settings.editor?.aiInlineCompletionStats)
    registerInlineCompletionProvider(monaco, () => (
      settings.editor?.inlineSuggest !== false && settings.editor?.aiInlineCompletions !== false
    ))
    registerFormatterProviders(
      monaco,
      () => project.activeProject?.rootPath,
      () => settings.editor?.defaultFormatter ?? 'auto'
    )
    isEditorReady.value = true
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : String(error)
  }
}

watch(() => editor.showDiff, () => {
  notifyEditorStatus()
})

watch(() => project.activeProject?.rootPath, (root, prev) => {
  if (prev && root !== prev) void stopAllLanguageClients()
})

watch(() => editor.tabs.map((tab) => tab.path), (paths, previousPaths = []) => {
  const openPaths = new Set(paths)
  for (const previousPath of previousPaths) {
    if (!openPaths.has(previousPath) && editor.secondaryTabPath === previousPath) {
      editor.secondaryTabPath = null
      if (editor.splitEnabled) editor.closeSplit()
    }
  }
})

watch(activeContent, () => {
  notifyEditorStatus()
})

watch(() => editor.showDiff, (showDiff) => {
  if (!showDiff) void ensureEditorServices()
})

onMounted(() => {
  registerEditorAccess({
    getSelection: () => null,
    getActivePath: () => editor.activeTabPath
  })
  window.addEventListener('keydown', handleGlobalShortcut, { capture: true })
  void nextTick(scrollActiveTabIntoView)
})

function handleGlobalShortcut(event: KeyboardEvent): void {
  if (!editor.activeTab || editor.showDiff) return
  const activeElement = document.activeElement
  if (!panelEl.value || (activeElement && !panelEl.value.contains(activeElement))) return

  const key = event.key.toLowerCase()
  const primaryModifier = event.metaKey || event.ctrlKey
  if (primaryModifier && !event.shiftKey && !event.altKey && key === 's') {
    event.preventDefault()
    event.stopPropagation()
    const path = editor.focusedPane === 'secondary' ? editor.secondaryTabPath : editor.activeTabPath
    if (path) {
      void (async () => {
        if (settings.editor?.formatOnSave !== false) {
          const pane = editor.focusedPane === 'secondary' ? secondaryPaneRef.value : primaryPaneRef.value
          pane?.runFormat()
        }
        await editor.saveFile(path)
      })()
    }
  }

  if (primaryModifier && event.altKey && !event.shiftKey && key === '\\') {
    event.preventDefault()
    if (editor.splitEnabled) editor.closeSplit()
    else if (editor.activeTabPath) void editor.openToSide(editor.activeTabPath)
  }

  if (primaryModifier && !event.shiftKey && !event.altKey && key === 'k') {
    event.preventDefault()
    openManualInlineEditComposer()
  }
}

function focusPane(pane: 'primary' | 'secondary'): void {
  editor.focusPane(pane)
  setInlineEditFocusedPane(pane)
  setManualInlineEditFocusedPane(pane)
}

const splitStyle = computed(() => {
  if (!editor.splitEnabled) return {}
  const ratio = Math.min(0.85, Math.max(0.15, editor.splitRatio))
  return { gridTemplateColumns: `${ratio}fr 4px ${1 - ratio}fr` }
})

function startSplitResize(event: MouseEvent): void {
  if (!splitHostEl.value) return
  draggingSplit.value = true
  const rect = splitHostEl.value.getBoundingClientRect()
  const onMove = (moveEvent: MouseEvent): void => {
    const ratio = (moveEvent.clientX - rect.left) / rect.width
    editor.splitRatio = Math.min(0.85, Math.max(0.15, ratio))
  }
  const onUp = (): void => {
    draggingSplit.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  event.preventDefault()
}

function getTabIcon(path: string): string {
  return failedTabIcons.value.has(path) ? '' : getFileIcon(path)
}

function fallbackTabIcon(path: string): void {
  failedTabIcons.value = new Set([...failedTabIcons.value, path])
}

function openTabMenu(event: MouseEvent, tab: OpenFileTab): void {
  event.preventDefault()
  editor.activeTabPath = tab.path
  const menuWidth = 284
  const menuHeight = 312
  const x = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8))
  const y = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8))
  tabMenu.value = { tab, x, y }
}

function closeTabMenu(): void {
  tabMenu.value = null
}

function requestCloseTab(tab: OpenFileTab): void {
  requestClosePaths([tab.path])
}

function requestCloseOthers(tab: OpenFileTab): void {
  requestClosePaths(editor.tabs.filter((item) => item.path !== tab.path).map((item) => item.path))
}

function requestCloseRight(tab: OpenFileTab): void {
  const index = editor.tabs.findIndex((item) => item.path === tab.path)
  if (index < 0) return
  requestClosePaths(editor.tabs.slice(index + 1).map((item) => item.path))
}

function requestCloseSaved(): void {
  requestClosePaths(editor.tabs.filter((tab) => !tab.isDirty).map((tab) => tab.path))
}

function requestCloseAll(): void {
  requestClosePaths(editor.tabs.map((tab) => tab.path))
}

function requestClosePaths(paths: string[]): void {
  const uniquePaths = [...new Set(paths)]
  if (!uniquePaths.length) return
  const pathSet = new Set(uniquePaths)
  const dirtyTabs = editor.tabs.filter((tab) => pathSet.has(tab.path) && tab.isDirty)
  if (!dirtyTabs.length) {
    editor.closeTabs(uniquePaths)
    return
  }
  pendingClose.value = { paths: uniquePaths, dirtyTabs }
}

async function saveAndClosePending(): Promise<void> {
  if (!pendingClose.value || savingClose.value) return
  savingClose.value = true
  try {
    for (const tab of pendingClose.value.dirtyTabs) {
      await editor.saveFile(tab.path)
    }
    editor.closeTabs(pendingClose.value.paths)
    pendingClose.value = null
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : String(error)
  } finally {
    savingClose.value = false
  }
}

function discardAndClosePending(): void {
  if (!pendingClose.value) return
  editor.closeTabs(pendingClose.value.paths)
  pendingClose.value = null
}

function cancelPendingClose(): void {
  if (savingClose.value) return
  pendingClose.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalShortcut, { capture: true })
  unregisterEditorAccess()
  unregisterEditorStatus()
})
</script>

<template>
  <div ref="panelEl" class="editor-panel">
    <div ref="tabsEl" class="editor-tabs pretty-scrollbar">
      <div
        v-for="tab in editor.tabs"
        :key="tab.path"
        role="button"
        tabindex="0"
        class="editor-tab"
        :data-path="tab.path"
        :class="{ active: tab.path === editor.activeTabPath }"
        :aria-label="tab.name"
        :title="tab.path"
        @click="editor.selectTab(tab.path)"
        @contextmenu="openTabMenu($event, tab)"
        @keydown.enter.prevent="editor.selectTab(tab.path)"
        @keydown.space.prevent="editor.selectTab(tab.path)"
      >
        <img
          v-if="getTabIcon(tab.path)"
          class="tab-file-icon"
          :src="getTabIcon(tab.path)"
          alt=""
          loading="lazy"
          @error="fallbackTabIcon(tab.path)"
        />
        <FileCode2 v-else :size="14" class="tab-fallback-icon" />
        <span class="tab-name">{{ tab.name }}</span>
        <button
          type="button"
          class="tab-close"
          :class="{ dirty: tab.isDirty }"
          :aria-label="t('editor.closeTab', { name: tab.name })"
          @click.stop="requestCloseTab(tab)"
        >
          <span class="tab-dirty-dot" />
          <X :size="15" :stroke-width="2.2" class="tab-close-x" />
        </button>
      </div>
    </div>

    <EditorTabContextMenu
      v-if="tabMenu"
      :tab="tabMenu.tab"
      :x="tabMenu.x"
      :y="tabMenu.y"
      @close="closeTabMenu"
      @close-tab="requestCloseTab"
      @close-others="requestCloseOthers"
      @close-right="requestCloseRight"
      @close-saved="requestCloseSaved"
      @close-all="requestCloseAll"
    />

    <EditorSaveChangesDialog
      v-if="pendingClose"
      :tabs="pendingClose.dirtyTabs"
      :saving="savingClose"
      @save="saveAndClosePending"
      @discard="discardAndClosePending"
      @cancel="cancelPendingClose"
    />

    <PackageJsonScriptsMenu />

    <EditorBreadcrumb v-if="(editor.activeTab || editor.showDiff || editor.showConflict) && !editor.activeExtensionId" />

    <ExtensionDetailView v-if="editor.activeExtensionId" :extension-id="editor.activeExtensionId" />

    <EditorConflictView v-else-if="editor.showConflict" />

    <EditorDiffView v-else-if="editor.showDiff" />

    <div v-else-if="editor.activeTab" class="editor-body">
      <div
        ref="splitHostEl"
        class="editor-split"
        :class="{ 'is-split': editor.splitEnabled, dragging: draggingSplit }"
        :style="splitStyle"
      >
        <EditorMonacoPane
          ref="primaryPaneRef"
          pane="primary"
          :tab-path="editor.activeTabPath"
          :focused="editor.focusedPane === 'primary'"
          @focus="focusPane('primary')"
        />
        <div
          v-if="editor.splitEnabled"
          class="split-divider"
          @mousedown="startSplitResize"
        />
        <EditorMonacoPane
          v-if="editor.splitEnabled && editor.secondaryTabPath"
          ref="secondaryPaneRef"
          pane="secondary"
          :tab-path="editor.secondaryTabPath"
          :focused="editor.focusedPane === 'secondary'"
          @focus="focusPane('secondary')"
        />
      </div>
      <div v-if="!isEditorReady && !editorError" class="editor-loading">
        {{ t('editor.loading') }}
      </div>
      <div v-if="editorError" class="editor-error">
        {{ editorError }}
      </div>
    </div>

    <div v-else class="editor-empty">
      <FileCode2 :size="34" />
      <p>{{ t('editor.empty') }}</p>
      <span>{{ t('editor.hint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.editor-panel {
  @apply flex h-full flex-col bg-codex-bg;
}
.editor-tabs {
  display: flex;
  height: var(--codex-editor-tab-height, 40px);
  flex-shrink: 0;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--codex-editor-chrome, var(--codex-sidebar, #f3f3f3));
  border-bottom: 1px solid var(--codex-border);
  scrollbar-width: none;
}
.editor-tab {
  position: relative;
  display: flex;
  height: var(--codex-editor-tab-height, 40px);
  min-width: 158px;
  max-width: 292px;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-right: 1px solid var(--codex-border);
  border-bottom: 1px solid var(--codex-border);
  background: var(--codex-editor-chrome, var(--codex-sidebar, #f3f3f3));
  color: var(--codex-text-secondary);
  font-size: 14px;
  font-weight: 500;
  outline: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.editor-tab.active {
  z-index: 1;
  margin-bottom: -1px;
  border-bottom-color: transparent;
  background: var(--codex-bg);
  color: var(--codex-accent);
}
.editor-tab.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: var(--codex-bg);
  content: "";
}
.editor-tab:hover {
  background: var(--codex-hover);
  color: var(--codex-text);
}
.editor-tab.active:hover {
  background: var(--codex-bg);
}
.editor-tab:focus-visible {
  box-shadow: inset 0 0 0 2px var(--codex-accent, #2563eb);
}
.tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-file-icon {
  flex-shrink: 0;
  object-fit: contain;
  width: 16px;
  height: 16px;
}
.tab-fallback-icon {
  flex-shrink: 0;
  color: var(--codex-muted);
}
.tab-close {
  display: flex;
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--codex-text-secondary);
  opacity: 0.75;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.editor-tab:not(.active):not(:hover) .tab-close {
  opacity: 0;
}
.editor-tab:not(.active):not(:hover) .tab-close.dirty {
  opacity: 1;
}
.tab-dirty-dot {
  display: none;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--codex-accent);
}
.tab-close-x {
  display: block;
  flex-shrink: 0;
}
.tab-close.dirty .tab-dirty-dot {
  display: block;
}
.tab-close.dirty .tab-close-x {
  display: none;
}
.editor-tab:hover .tab-close.dirty .tab-dirty-dot,
.tab-close.dirty:focus-visible .tab-dirty-dot {
  display: none;
}
.editor-tab:hover .tab-close.dirty .tab-close-x,
.tab-close.dirty:focus-visible .tab-close-x {
  display: block;
}
.tab-close:hover {
  background: var(--codex-hover);
  color: var(--codex-text);
}
.tab-close:focus-visible {
  background: var(--codex-hover);
  opacity: 1;
  outline: none;
}
.editor-tabs::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.editor-tabs::-webkit-scrollbar-track {
  background: transparent;
  margin: 0;
}
.editor-tabs::-webkit-scrollbar-thumb {
  border: 0;
  border-radius: 999px;
  background-color: transparent;
}
.editor-body {
  @apply relative min-h-0 flex-1;
}
.editor-split {
  display: grid;
  height: 100%;
  min-height: 0;
  width: 100%;
}
.editor-split:not(.is-split) {
  grid-template-columns: minmax(0, 1fr);
}
.editor-split.dragging {
  cursor: col-resize;
  user-select: none;
}
.split-divider {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--codex-border);
  transition: background-color 0.15s ease;
}
.split-divider:hover {
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 45%, var(--codex-border));
}
.editor-loading,
.editor-error {
  @apply pointer-events-none absolute inset-0 flex items-center justify-center bg-codex-bg text-[12px] text-codex-muted;
}
.editor-error {
  @apply px-8 text-center text-red-500;
}
.editor-empty {
  @apply flex flex-1 flex-col items-center justify-center gap-2 text-center text-codex-muted;
}
.editor-empty p {
  @apply text-[14px] font-medium text-codex-text-secondary;
}
.editor-empty span {
  @apply text-[12px];
}
:global(.lucky-monaco-peek) {
  overflow: hidden;
  border: 1px solid var(--codex-border, #d9d9d9);
  border-radius: 8px;
  background: var(--codex-bg, #ffffff);
  box-shadow: 0 14px 38px rgb(0 0 0 / 12%);
}
:global(.lucky-monaco-peek-head) {
  display: flex;
  height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--codex-border, #d9d9d9);
  background: var(--codex-surface, #f6f6f6);
  padding: 0 8px 0 10px;
}
:global(.lucky-monaco-peek-title) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--codex-text, #1f1f1f);
  font-size: 12px;
  font-weight: 500;
}
:global(.lucky-monaco-peek-close) {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 5px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 17px;
  line-height: 1;
}
:global(.lucky-monaco-peek-close:hover) {
  background: var(--codex-hover, #ececec);
  color: var(--codex-text, #1f1f1f);
}
:global(.lucky-monaco-peek-body) {
  height: 246px;
}
:global(.lucky-monaco-ai-add) {
  background: rgb(20 160 92 / 14%);
}
:global(.lucky-monaco-ai-remove) {
  background: rgb(220 72 108 / 14%);
}
:global(.lucky-monaco-ai-preview) {
  background: rgb(47 112 255 / 12%);
}
:global([data-theme='dark'] .lucky-monaco-peek) {
  background: #1f1f1f;
  box-shadow: 0 18px 44px rgb(0 0 0 / 34%);
}
:global([data-theme='dark'] .lucky-monaco-peek-head) {
  background: #252526;
}
:global(.lucky-ai-inline-edit-bar) {
  display: inline-flex;
  gap: 4px;
  border: 1px solid var(--codex-border, #d9d9d9);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  padding: 4px;
}
:global(.lucky-ai-inline-edit-btn) {
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
}
:global(.lucky-ai-inline-edit-btn.keep) {
  background: rgb(20 160 92 / 14%);
  color: #148a4f;
}
:global(.lucky-ai-inline-edit-btn.undo) {
  background: rgb(220 72 108 / 12%);
  color: #c2413b;
}
:global(.lucky-ai-inline-edit-composer) {
  width: min(420px, calc(100vw - 64px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--codex-border, #d9d9d9);
  border-radius: 12px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 18px 44px rgb(0 0 0 / 16%);
  padding: 12px;
}
:global(.lucky-ai-inline-edit-title) {
  font-size: 12px;
  font-weight: 700;
  color: var(--codex-text, #1f1f1f);
}
:global(.lucky-ai-inline-edit-input) {
  min-height: 92px;
  resize: vertical;
  border: 1px solid var(--codex-border, #d9d9d9);
  border-radius: 10px;
  background: color-mix(in srgb, var(--codex-bg, #fff) 92%, var(--codex-hover, #f3f3f3));
  color: var(--codex-text, #1f1f1f);
  padding: 10px 12px;
  font: inherit;
}
:global(.lucky-ai-inline-edit-status) {
  min-height: 18px;
  font-size: 11px;
  color: var(--codex-muted, #6b7280);
}
:global(.lucky-ai-inline-edit-actions) {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
