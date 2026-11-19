<script setup lang="ts">
import 'monaco-editor/min/vs/editor/editor.main.css'

import type * as Monaco from 'monaco-editor'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  createDiffModels,
  initializeMonacoHighlighting,
  loadMonaco,
  popDiffEditorValidationScope,
  pushDiffEditorValidationScope,
  resolveEditorLanguage,
  resolveMonacoEditorTheme
} from '../../services/monaco.service.js'
import { applyMonacoTheme } from '../../services/monaco-runtime.service.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useThemeStore } from '../../stores/theme.store.js'

const props = withDefaults(defineProps<{
  original: string
  modified: string
  path?: string
  readOnly?: boolean
  inline?: boolean
  height?: string
}>(), {
  path: '',
  readOnly: true,
  inline: false,
  height: '100%'
})

const instanceId = `diff-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
const theme = useThemeStore()
const settings = useSettingsStore()

const containerEl = ref<HTMLElement | null>(null)
const diffEditor = shallowRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
const monacoApi = shallowRef<typeof Monaco | null>(null)
const isReady = ref(false)
const loadError = ref('')

let disposed = false
let validationScopeActive = false
let scrollDisposable: Monaco.IDisposable | null = null
let layoutDisposable: Monaco.IDisposable | null = null
let mouseMoveDisposable: Monaco.IDisposable | null = null
let mouseLeaveDisposable: Monaco.IDisposable | null = null
let cursorDisposable: Monaco.IDisposable | null = null
let initialRevealDone = false

const emit = defineEmits<{
  layout: []
  hunkLine: [lineNumber: number]
  hunkLeave: []
}>()

function safeDisposeModel(model: Monaco.editor.ITextModel | null | undefined): void {
  if (!model) return
  try {
    if (!model.isDisposed()) model.dispose()
  } catch {
    // Ignore races during diff editor teardown.
  }
}

function releaseAttachedModels(editor: Monaco.editor.IStandaloneDiffEditor): void {
  const attached = editor.getModel()
  editor.setModel(null)
  safeDisposeModel(attached?.original)
  safeDisposeModel(attached?.modified)
}

function revealFirstDiff(): void {
  const editor = diffEditor.value
  if (!editor || disposed) return
  const changes = editor.getLineChanges()
  const first = changes?.[0]
  if (!first) return
  const line = first.modifiedStartLineNumber || first.originalStartLineNumber || 1
  revealModifiedLine(line)
}

function revealModifiedLine(lineNumber: number): void {
  const editor = diffEditor.value?.getModifiedEditor()
  if (!editor || disposed) return
  const safeLine = Math.max(1, lineNumber)
  editor.revealLineInCenter(safeLine)
  editor.setPosition({ lineNumber: safeLine, column: 1 })
  editor.focus()
  emit('layout')
}

function getModifiedLineCoords(lineNumber: number): { top: number; left: number; lineHeight: number } | null {
  const editor = diffEditor.value?.getModifiedEditor()
  if (!editor || disposed) return null
  const safeLine = Math.max(1, lineNumber)
  const top = editor.getTopForLineNumber(safeLine) - editor.getScrollTop()
  const layout = editor.getLayoutInfo()
  const monaco = monacoApi.value
  const lineHeight = monaco ? editor.getOption(monaco.editor.EditorOption.lineHeight) : 22
  return {
    top: Math.max(0, top),
    left: layout.contentLeft + 12,
    lineHeight
  }
}

function attachModifiedEditorListeners(): void {
  scrollDisposable?.dispose()
  layoutDisposable?.dispose()
  mouseMoveDisposable?.dispose()
  mouseLeaveDisposable?.dispose()
  cursorDisposable?.dispose()
  scrollDisposable = null
  layoutDisposable = null
  mouseMoveDisposable = null
  mouseLeaveDisposable = null
  cursorDisposable = null

  const editor = diffEditor.value?.getModifiedEditor()
  if (!editor || disposed) return

  scrollDisposable = editor.onDidScrollChange(() => emit('layout'))
  layoutDisposable = editor.onDidLayoutChange(() => emit('layout'))
  mouseMoveDisposable = editor.onMouseMove((event) => {
    const lineNumber = event.target.position?.lineNumber
    if (lineNumber) emit('hunkLine', lineNumber)
  })
  mouseLeaveDisposable = editor.onMouseLeave(() => emit('hunkLeave'))
  cursorDisposable = editor.onDidChangeCursorPosition((event) => {
    emit('hunkLine', event.position.lineNumber)
  })
}

function syncModels(): void {
  const editor = diffEditor.value
  const monaco = monacoApi.value
  if (!editor || !monaco || disposed) return

  const language = resolveEditorLanguage(props.path)
  const attached = editor.getModel()

  if (attached?.original && attached.modified && !attached.original.isDisposed() && !attached.modified.isDisposed()) {
    const modifiedEditor = editor.getModifiedEditor()
    const viewState = modifiedEditor.saveViewState()
    if (attached.original.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(attached.original, language)
      monaco.editor.setModelLanguage(attached.modified, language)
    }
    if (attached.original.getValue() !== props.original) attached.original.setValue(props.original)
    if (attached.modified.getValue() !== props.modified) attached.modified.setValue(props.modified)
    if (viewState) {
      modifiedEditor.restoreViewState(viewState)
    }
    attachModifiedEditorListeners()
    emit('layout')
    return
  }

  releaseAttachedModels(editor)
  const next = createDiffModels(monaco, props.path, props.original, props.modified, instanceId)
  editor.setModel(next)
  attachModifiedEditorListeners()
  if (!initialRevealDone) {
    initialRevealDone = true
    void nextTick(revealFirstDiff)
  }
}

async function initDiffEditor(): Promise<void> {
  if (!containerEl.value || diffEditor.value || disposed) return

  try {
    const monaco = await loadMonaco()
    if (disposed || !containerEl.value) return

    monacoApi.value = monaco
    await initializeMonacoHighlighting(monaco)
    pushDiffEditorValidationScope(monaco)
    validationScopeActive = true
    applyMonacoTheme(monaco, theme.resolvedMode, settings.editor)
    if (disposed || !containerEl.value) return

    diffEditor.value = monaco.editor.createDiffEditor(containerEl.value, {
      automaticLayout: true,
      readOnly: props.readOnly,
      renderSideBySide: !props.inline,
      useInlineViewWhenSpaceIsLimited: props.inline,
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontLigatures: true,
      fontSize: 13,
      lineHeight: 22,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      theme: resolveMonacoEditorTheme(theme.resolvedMode, settings.editor),
      wordWrap: 'off',
      renderOverviewRuler: true,
      diffCodeLens: false,
      enableSplitViewResizing: !props.inline
    })

    if (disposed) {
      diffEditor.value.dispose()
      diffEditor.value = null
      return
    }

    syncModels()
    isReady.value = true
  } catch (error) {
    if (monacoApi.value && validationScopeActive) {
      popDiffEditorValidationScope(monacoApi.value)
      validationScopeActive = false
    }
    if (!disposed) {
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  }
}

function releaseValidationScope(): void {
  const monaco = monacoApi.value
  if (!monaco || !validationScopeActive) return
  popDiffEditorValidationScope(monaco)
  validationScopeActive = false
}

function destroyDiffEditor(): void {
  disposed = true
  const editor = diffEditor.value

  try {
    if (editor) {
      releaseAttachedModels(editor)
      editor.dispose()
    }
  } catch {
    // Ignore cleanup races — component is unmounting.
  } finally {
    scrollDisposable?.dispose()
    layoutDisposable?.dispose()
    mouseMoveDisposable?.dispose()
    mouseLeaveDisposable?.dispose()
    cursorDisposable?.dispose()
    scrollDisposable = null
    layoutDisposable = null
    mouseMoveDisposable = null
    mouseLeaveDisposable = null
    cursorDisposable = null
    diffEditor.value = null
    releaseValidationScope()
  }
}

watch(() => [props.original, props.modified, props.path] as const, () => {
  if (diffEditor.value && !disposed) syncModels()
})

watch(() => props.readOnly, (readOnly) => {
  if (!disposed) diffEditor.value?.updateOptions({ readOnly })
})

watch(() => props.inline, (inline) => {
  if (disposed || !diffEditor.value) return
  diffEditor.value.updateOptions({
    renderSideBySide: !inline,
    useInlineViewWhenSpaceIsLimited: inline,
    enableSplitViewResizing: !inline
  })
  emit('layout')
})

watch(() => theme.resolvedMode, (mode) => {
  const monaco = monacoApi.value
  if (!monaco || disposed) return
  applyMonacoTheme(monaco, mode, settings.editor)
})
watch(() => [settings.editor.monacoThemeLight, settings.editor.monacoThemeDark], () => {
  const monaco = monacoApi.value
  if (!monaco || disposed) return
  applyMonacoTheme(monaco, theme.resolvedMode, settings.editor)
})

onMounted(() => {
  void initDiffEditor()
})

onBeforeUnmount(() => {
  destroyDiffEditor()
})

defineExpose({
  revealModifiedLine,
  revealFirstDiff,
  getModifiedLineCoords
})
</script>

<template>
  <div class="monaco-diff-host" :style="{ height }">
    <div ref="containerEl" class="monaco-diff-container" />
    <div v-if="!isReady && !loadError" class="monaco-diff-loading" />
    <div v-if="loadError" class="monaco-diff-error">{{ loadError }}</div>
  </div>
</template>

<style scoped>
.monaco-diff-host {
  position: relative;
  min-height: 0;
  width: 100%;
}

.monaco-diff-container {
  width: 100%;
  height: 100%;
}

.monaco-diff-loading {
  position: absolute;
  inset: 0;
  background: var(--codex-bg, #fafafa);
}

.monaco-diff-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: #dc486c;
  font-size: 12px;
  text-align: center;
}
</style>
