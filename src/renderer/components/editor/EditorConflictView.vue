<script setup lang="ts">
import 'monaco-editor/min/vs/editor/editor.main.css'

import type * as Monaco from 'monaco-editor'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronLeft, GitMerge, X } from 'lucide-vue-next'
import {
  applyAllConflictResolution,
  applyConflictResolution,
  buildConflictDecorationRanges,
  parseGitConflictMarkers,
  type GitConflictRegion
} from '../../../shared/utils/git-conflict.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import {
  createEditorModel,
  initializeMonacoHighlighting,
  loadMonaco
} from '../../services/monaco.service.js'
import { applyMonacoTheme } from '../../services/monaco-runtime.service.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useThemeStore } from '../../stores/theme.store.js'
import type { WorkspaceGitStatus } from '../../../shared/types/workspace.js'
import { resolveWorkspaceFilePath } from '../../../shared/utils/workspace-path.js'

const { t } = useI18n()
const editor = useEditorStore()
const project = useProjectStore()
const theme = useThemeStore()
const settings = useSettingsStore()

const hostEl = ref<HTMLElement | null>(null)
const monacoApi = shallowRef<typeof Monaco | null>(null)
const monacoEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const modelDisposable = shallowRef<Monaco.IDisposable | null>(null)
const decorationIds = shallowRef<string[]>([])
const activeRegionId = ref<string | null>(null)
const saving = ref(false)
const error = ref('')

const regions = computed(() => parseGitConflictMarkers(editor.conflictWorking).regions)
const activeRegion = computed(() => regions.value.find((region) => region.id === activeRegionId.value) ?? regions.value[0] ?? null)

watch(() => editor.conflictWorking, () => {
  void bindModel()
  highlightConflicts()
}, { immediate: true })

watch(activeRegion, (region) => {
  if (region && !activeRegionId.value) activeRegionId.value = region.id
})

async function ensureEditor(): Promise<void> {
  if (monacoEditor.value || !hostEl.value) return
  const monaco = await loadMonaco()
  monacoApi.value = monaco
  await initializeMonacoHighlighting(monaco)
  applyMonacoTheme(monaco, theme.resolvedMode, settings.editor)
  monacoEditor.value = monaco.editor.create(hostEl.value, {
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 22,
    minimap: { enabled: false },
    wordWrap: 'off'
  })
  await bindModel()
  highlightConflicts()
}

async function bindModel(): Promise<void> {
  await ensureEditor()
  const monaco = monacoApi.value
  const instance = monacoEditor.value
  if (!monaco || !instance || !editor.conflictPath) return

  const absPath = resolveWorkspaceFilePath(editor.conflictPath, project.activeProject?.rootPath)
  const model = createEditorModel(monaco, absPath, editor.conflictWorking)
  instance.setModel(model)
  modelDisposable.value?.dispose()
  modelDisposable.value = model.onDidChangeContent(() => {
    editor.updateConflictWorking(model.getValue())
    highlightConflicts()
  })
}

function highlightConflicts(): void {
  const instance = monacoEditor.value
  if (!instance) return
  const specs = regions.value.flatMap((region) =>
    buildConflictDecorationRanges(region, region.id === activeRegion.value?.id).map((item) => ({
      range: {
        startLineNumber: item.startLineNumber,
        startColumn: 1,
        endLineNumber: item.endLineNumber,
        endColumn: 1
      },
      options: {
        isWholeLine: true,
        className: item.className,
        inlineClassName: item.className
      }
    }))
  )
  decorationIds.value = instance.deltaDecorations(decorationIds.value, specs)
}

function selectRegion(region: GitConflictRegion): void {
  activeRegionId.value = region.id
  highlightConflicts()
  monacoEditor.value?.revealLineInCenter(region.markerStartLine)
}

function applyRegion(side: 'ours' | 'theirs'): void {
  const region = activeRegion.value
  if (!region) return
  const next = applyConflictResolution(editor.conflictWorking, region, side)
  editor.updateConflictWorking(next)
  activeRegionId.value = regions.value[0]?.id ?? null
}

function applyAll(side: 'ours' | 'theirs'): void {
  editor.updateConflictWorking(applyAllConflictResolution(editor.conflictWorking, side))
  activeRegionId.value = regions.value[0]?.id ?? null
}

async function markResolved(): Promise<void> {
  if (!editor.conflictPath || saving.value) return
  if (regions.value.length) {
    error.value = t('git.conflictUnresolved')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const status = await unwrap<WorkspaceGitStatus>(
      ipc.workspace.resolveGitConflictFile(editor.conflictPath, editor.conflictWorking, project.activeProject?.rootPath)
    )
    project.gitStatus = status
    project.gitBranch = status.branch
    editor.closeConflict()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function close(): void {
  editor.closeConflict()
}

onBeforeUnmount(() => {
  modelDisposable.value?.dispose()
  monacoEditor.value?.dispose()
  monacoEditor.value = null
})
</script>

<template>
  <section class="conflict-view">
    <header class="conflict-header">
      <button type="button" class="icon-btn" :title="t('common.close')" @click="close">
        <ChevronLeft :size="16" />
      </button>
      <GitMerge :size="16" />
      <div class="conflict-title">
        <strong>{{ editor.conflictPath }}</strong>
        <span>{{ t('git.conflictEditorTitle', { count: regions.length }) }}</span>
      </div>
      <button type="button" class="resolve-btn" :disabled="saving" @click="markResolved">
        <Check :size="15" />
        <span>{{ saving ? t('git.conflictSaving') : t('git.markResolved') }}</span>
      </button>
      <button type="button" class="icon-btn" @click="close">
        <X :size="16" />
      </button>
    </header>

    <div class="conflict-body">
      <aside class="conflict-sidebar pretty-scrollbar">
        <div class="sidebar-head">{{ t('git.conflictRegions') }}</div>
        <button
          v-for="(region, index) in regions"
          :key="region.id"
          type="button"
          class="region-item"
          :class="{ active: region.id === activeRegion?.id }"
          @click="selectRegion(region)"
        >
          <span>{{ t('git.conflictRegion', { index: index + 1 }) }}</span>
          <small>{{ region.markerStartLine }}–{{ region.markerEndLine }}</small>
        </button>
        <p v-if="!regions.length" class="sidebar-empty">{{ t('git.conflictAllResolved') }}</p>
      </aside>

      <div class="conflict-editor">
        <div ref="hostEl" class="monaco-host" />
      </div>

      <aside v-if="activeRegion" class="conflict-compare pretty-scrollbar">
        <div class="compare-block">
          <div class="compare-head">
            <span>{{ t('git.acceptOurs') }}</span>
            <button type="button" @click="applyRegion('ours')">{{ t('git.accept') }}</button>
          </div>
          <pre>{{ activeRegion.ours || t('git.emptySide') }}</pre>
        </div>
        <div class="compare-block">
          <div class="compare-head">
            <span>{{ t('git.acceptTheirs') }}</span>
            <button type="button" @click="applyRegion('theirs')">{{ t('git.accept') }}</button>
          </div>
          <pre>{{ activeRegion.theirs || t('git.emptySide') }}</pre>
        </div>
        <div class="compare-actions">
          <button type="button" @click="applyAll('ours')">{{ t('git.acceptAllOurs') }}</button>
          <button type="button" @click="applyAll('theirs')">{{ t('git.acceptAllTheirs') }}</button>
        </div>
        <div v-if="editor.conflictBase" class="compare-block muted">
          <div class="compare-head"><span>{{ t('git.base') }}</span></div>
          <pre>{{ editor.conflictBase }}</pre>
        </div>
      </aside>
    </div>

    <p v-if="error" class="conflict-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.conflict-view {
  @apply flex min-h-0 flex-1 flex-col bg-codex-bg;
}
.conflict-header {
  @apply flex h-11 shrink-0 items-center gap-2 border-b border-codex-border px-3;
}
.conflict-title {
  @apply min-w-0 flex-1;
}
.conflict-title strong {
  @apply block truncate text-[13px] font-semibold text-codex-text;
}
.conflict-title span {
  @apply text-[11px] text-codex-muted;
}
.icon-btn {
  @apply flex h-8 w-8 items-center justify-center rounded-md text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text;
}
.resolve-btn {
  @apply flex h-8 items-center gap-1.5 rounded-md bg-[#3f87b8] px-3 text-[12px] font-semibold text-white hover:bg-[#3578a7] disabled:opacity-50;
}
.conflict-body {
  @apply grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_280px];
}
.conflict-sidebar,
.conflict-compare {
  @apply min-h-0 overflow-y-auto border-codex-border bg-codex-sidebar p-2;
}
.conflict-sidebar {
  @apply border-r;
}
.conflict-compare {
  @apply border-l;
}
.sidebar-head {
  @apply px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-codex-muted;
}
.region-item {
  @apply mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[12px] hover:bg-codex-hover;
}
.region-item.active {
  @apply bg-codex-hover text-codex-accent;
}
.region-item small {
  @apply text-codex-muted;
}
.sidebar-empty {
  @apply px-2 py-3 text-[12px] text-codex-muted;
}
.conflict-editor {
  @apply min-h-0 min-w-0;
}
.monaco-host {
  @apply h-full w-full;
}
.compare-block {
  @apply mb-3 rounded-md border border-codex-border bg-codex-bg p-2;
}
.compare-block.muted pre {
  @apply text-codex-muted;
}
.compare-head {
  @apply mb-2 flex items-center justify-between gap-2 text-[12px] font-semibold;
}
.compare-head button,
.compare-actions button {
  @apply rounded px-2 py-1 text-[11px] font-semibold text-codex-accent hover:bg-codex-hover;
}
.compare-block pre {
  @apply max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed;
}
.compare-actions {
  @apply mb-3 flex flex-col gap-1;
}
.conflict-error {
  @apply border-t border-codex-border px-3 py-2 text-[12px] text-red-600;
}
:global(.lucky-conflict-ours) {
  background: rgb(46 160 67 / 12%);
}
:global(.lucky-conflict-ours-active) {
  background: rgb(46 160 67 / 20%);
}
:global(.lucky-conflict-theirs) {
  background: rgb(56 139 253 / 12%);
}
:global(.lucky-conflict-theirs-active) {
  background: rgb(56 139 253 / 20%);
}
:global(.lucky-conflict-marker-start),
:global(.lucky-conflict-marker-end) {
  background: rgb(220 72 108 / 14%);
}
:global(.lucky-conflict-marker-start-active),
:global(.lucky-conflict-marker-end-active) {
  background: rgb(220 72 108 / 24%);
}
:global(.lucky-conflict-separator) {
  background: rgb(210 153 34 / 14%);
}
:global(.lucky-conflict-separator-active) {
  background: rgb(210 153 34 / 24%);
}
</style>
