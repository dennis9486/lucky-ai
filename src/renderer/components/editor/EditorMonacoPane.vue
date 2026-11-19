<script setup lang="ts">
import type * as Monaco from 'monaco-editor'
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { resolveWorkspaceFilePath } from '../../../shared/utils/workspace-path.js'
import {
  createEditorModel,
  configureWorkspaceLanguageServices,
  disposeEditorModel,
  isEditorModelForPath,
  loadMonaco,
  resolveEditorLanguage
} from '../../services/monaco.service.js'
import {
  applyMonacoTheme,
  createMonacoRuntime,
  type MonacoRuntime
} from '../../services/monaco-runtime.service.js'
import {
  ensureLanguageClient,
  registerMonacoLspFeatures,
  syncChangeDocument,
  syncCloseDocument,
  syncOpenDocument
} from '../../services/lsp-client.service.js'
import { bindPackageJsonScriptEditor } from '../../services/package-json-codelens.service.js'
import { bindInlineCompletionEditor } from '../../services/inline-completion.service.js'
import {
  registerMonacoPane,
  unregisterMonacoPane
} from '../../services/monaco-runtime.registry.js'

import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useThemeStore } from '../../stores/theme.store.js'
import type { OpenFileTab } from '../../../shared/types/workspace.js'

const props = defineProps<{
  pane: 'primary' | 'secondary'
  tabPath: string | null
  focused: boolean
}>()

const emit = defineEmits<{
  focus: []
}>()

const editor = useEditorStore()
const project = useProjectStore()
const settings = useSettingsStore()
const theme = useThemeStore()

const hostEl = shallowRef<HTMLElement | null>(null)
const monacoApi = shallowRef<typeof Monaco | null>(null)
const monacoEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRuntime = shallowRef<MonacoRuntime | null>(null)
const modelDisposable = shallowRef<Monaco.IDisposable | null>(null)
const packageJsonDisposable = shallowRef<Monaco.IDisposable | null>(null)
const inlineCompletionDisposable = shallowRef<Monaco.IDisposable | null>(null)
let suppressContentSync = 0
let bindGeneration = 0

function runWithSuppressedContentSync(fn: () => void): void {
  suppressContentSync += 1
  try {
    fn()
  } finally {
    suppressContentSync -= 1
  }
}

function getTab(): OpenFileTab | null {
  if (!props.tabPath) return null
  return editor.tabs.find((tab) => tab.path === props.tabPath) ?? null
}

async function ensureEditor(): Promise<void> {
  if (monacoEditor.value || !hostEl.value) return
  const monaco = await loadMonaco()
  monacoApi.value = monaco
  applyMonacoTheme(monaco, theme.resolvedMode, settings.editor)

  monacoEditor.value = monaco.editor.create(hostEl.value, {
    automaticLayout: true,
    cursorBlinking: 'smooth',
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontLigatures: true,
    fontSize: 13,
    lineHeight: 22,
    links: true,
    hover: { enabled: true, sticky: true, above: false },
    inlayHints: { enabled: 'on' },
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    minimap: { enabled: false },
    multiCursorModifier: 'alt',
    padding: { top: 16, bottom: 16 },
    parameterHints: { enabled: true, cycle: true },
    quickSuggestions: { other: true, comments: false, strings: true },
    renderLineHighlight: 'line',
    roundedSelection: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    suggest: { preview: true, showIcons: true, showInlineDetails: true, snippetsPreventQuickSuggestions: false },
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
    inlineSuggest: { enabled: settings.editor?.inlineSuggest !== false },
    wordBasedSuggestions: 'off',
    wordWrap: 'off',
    codeLens: true,
    contextmenu: true,
    gotoLocation: {
      multipleDefinitions: 'peek',
      multipleReferences: 'peek',
      multipleDeclarations: 'peek',
      multipleImplementations: 'peek',
      multipleTypeDefinitions: 'peek'
    },
    formatOnPaste: settings.editor?.formatOnPaste === true
  })

  registerMonacoLspFeatures(monaco, monacoEditor.value)
  monacoRuntime.value = createMonacoRuntime(monaco, monacoEditor.value, {
    getThemeMode: () => theme.resolvedMode,
    getEditorSettings: () => settings.editor,
    saveFile: async () => {
      const path = props.tabPath
      if (path) await editor.saveFile(path)
    },
    openLocation: async (location) => {
      const absPath = resolveWorkspaceFilePath(location.uri.fsPath, project.activeProject?.rootPath)
      const root = project.activeProject?.rootPath?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
      const tabPath = root && absPath.startsWith(`${root}/`) ? absPath.slice(root.length + 1) : absPath
      await editor.openFile(tabPath, {
        lineNumber: location.range.startLineNumber,
        column: location.range.startColumn,
        endColumn: location.range.endColumn
      })
    }
  })
  packageJsonDisposable.value = bindPackageJsonScriptEditor(monaco, monacoEditor.value)
  registerMonacoPane({
    pane: props.pane,
    runtime: monacoRuntime.value,
    editor: monacoEditor.value,
    tabPath: () => props.tabPath
  })
  inlineCompletionDisposable.value = bindInlineCompletionEditor(monacoEditor.value)
  monacoEditor.value.onDidFocusEditorText(() => emit('focus'))
  await bindModel()
}

async function bindModel(): Promise<void> {
  await nextTick()
  const tab = getTab()
  if (!hostEl.value) return
  await ensureEditor()

  const monaco = monacoApi.value
  const instance = monacoEditor.value
  if (!monaco || !instance || !tab) return

  const generation = ++bindGeneration
  const path = tab.path

  modelDisposable.value?.dispose()
  modelDisposable.value = null

  const workspaceRoot = project.activeProject?.rootPath
  const filePath = resolveWorkspaceFilePath(path, workspaceRoot)
  const lang = resolveEditorLanguage(path)
  const usesExternalLsp = Boolean(workspaceRoot) && ['typescript', 'javascript', 'vue'].includes(lang)
  let model: Monaco.editor.ITextModel | null = null

  suppressContentSync += 1
  try {
    if (usesExternalLsp && workspaceRoot) {
      await configureWorkspaceLanguageServices(monaco, workspaceRoot, true)
      const client = await ensureLanguageClient(path, workspaceRoot)
      if (client.status !== 'running') {
        await configureWorkspaceLanguageServices(monaco, workspaceRoot, false)
      }
    }

    model = createEditorModel(monaco, filePath, tab.content)

    runWithSuppressedContentSync(() => {
      instance.setModel(model!)
    })

    modelDisposable.value = model.onDidChangeContent(() => {
      if (generation !== bindGeneration) return
      if (suppressContentSync > 0) return
      editor.syncTabBuffer(path, model!.getValue(), model!.getAlternativeVersionId())
      void syncChangeDocument(path, model!.getValue())
    })

    if (workspaceRoot) {
      const client = await ensureLanguageClient(path, workspaceRoot)
      if (client.status === 'running') {
        await syncOpenDocument(path, model.getValue())
      }
    }
  } finally {
    if (model && generation === bindGeneration) {
      const currentTab = editor.tabs.find((entry) => entry.path === path)
      if (currentTab && (!currentTab.isDirty || currentTab.pristineVersionId === null)) {
        editor.commitTabPristine(path, model.getValue(), model.getAlternativeVersionId())
      } else if (currentTab) {
        editor.syncTabBuffer(path, model.getValue(), model.getAlternativeVersionId())
      }
    }
    suppressContentSync -= 1
  }

  if (props.focused) instance.focus()
}

function disposeEditor(): void {
  unregisterMonacoPane(props.pane)
  modelDisposable.value?.dispose()
  modelDisposable.value = null
  packageJsonDisposable.value?.dispose()
  packageJsonDisposable.value = null
  inlineCompletionDisposable.value?.dispose()
  inlineCompletionDisposable.value = null
  monacoRuntime.value?.dispose()
  monacoRuntime.value = null
  monacoEditor.value?.dispose()
  monacoEditor.value = null
}

onMounted(() => {
  void bindModel()
})

watch(() => props.tabPath, () => {
  unregisterMonacoPane(props.pane)
  if (monacoRuntime.value && monacoEditor.value) {
    registerMonacoPane({
      pane: props.pane,
      runtime: monacoRuntime.value,
      editor: monacoEditor.value,
      tabPath: () => props.tabPath
    })
  }
  void bindModel()
}, { flush: 'post' })

watch(() => getTab()?.content, (content) => {
  const tab = getTab()
  const model = monacoEditor.value?.getModel()
  if (!tab || !model || content === undefined) return
  if (!isEditorModelForPath(model, tab.path, project.activeProject?.rootPath)) return
  if (model.getValue() === content) return
  runWithSuppressedContentSync(() => {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
  })
  if (!tab.isDirty) {
    editor.commitTabPristine(tab.path, model.getValue(), model.getAlternativeVersionId())
  } else {
    editor.syncTabBuffer(tab.path, model.getValue(), model.getAlternativeVersionId())
  }
})
watch(() => theme.resolvedMode, (mode) => {
  const monaco = monacoApi.value
  if (monaco) applyMonacoTheme(monaco, mode, settings.editor)
})
watch(() => [settings.editor.monacoThemeLight, settings.editor.monacoThemeDark], () => {
  const monaco = monacoApi.value
  if (monaco) applyMonacoTheme(monaco, theme.resolvedMode, settings.editor)
})
watch(() => props.focused, (focused) => {
  if (focused) monacoEditor.value?.focus()
})

onBeforeUnmount(() => {
  const monaco = monacoApi.value
  const tab = getTab()
  if (monaco && tab) {
    void syncCloseDocument(tab.path)
    disposeEditorModel(monaco, resolveWorkspaceFilePath(tab.path, project.activeProject?.rootPath))
  }
  disposeEditor()
})

defineExpose({
  focus: () => monacoEditor.value?.focus(),
  runFormat: () => monacoEditor.value?.getAction('editor.action.formatDocument')?.run()
})
</script>

<template>
  <div class="monaco-pane" :class="{ focused }" @mousedown="emit('focus')">
    <div ref="hostEl" class="monaco-host" />
  </div>
</template>

<style scoped>
.monaco-pane {
  @apply relative min-h-0 min-w-0 flex-1;
}
.monaco-pane.focused {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--codex-accent, #2563eb) 35%, transparent);
}
.monaco-host {
  @apply h-full w-full bg-codex-bg;
}
</style>
