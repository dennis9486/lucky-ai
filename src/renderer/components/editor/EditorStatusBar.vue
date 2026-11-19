<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  Bell,
  Bot,
  Braces,
  Cloud,
  GitBranch,
  XCircle
} from 'lucide-vue-next'
import { listDiagnostics, subscribeDiagnostics } from '../../services/lsp-client.service.js'
import type { LspDiagnosticsPayload } from '../../../shared/types/lsp.js'
import {
  subscribeEditorStatus,
  type EditorStatusSnapshot
} from '../../services/editor-status.registry.js'
import { resolveEditorLanguage } from '../../services/monaco.service.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useTerminalStore } from '../../stores/terminal.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'

const { t } = useI18n()
const editor = useEditorStore()
const project = useProjectStore()
const terminal = useTerminalStore()
const ui = useUiStore()

const editorStatus = ref<EditorStatusSnapshot | null>(null)
const diagnostics = ref<LspDiagnosticsPayload[]>(listDiagnostics())
let unsubscribeStatus: (() => void) | null = null
let unsubscribeDiagnostics: (() => void) | null = null

const workspaceName = computed(() => project.activeProject?.name ?? '')

const branchLabel = computed(() => {
  if (!project.gitStatus.isRepository) return ''
  const branch = project.gitBranch ?? project.gitStatus.branch ?? 'HEAD'
  return project.gitStatus.dirtyCount > 0 ? `${branch}*` : branch
})

const syncTooltip = computed(() => {
  const { ahead = 0, behind = 0, upstream } = project.gitStatus
  if (!upstream) return t('branch.noUpstream')
  if (ahead === 0 && behind === 0) return t('statusBar.synced')
  return t('branch.aheadBehind', { ahead, behind })
})

const showSync = computed(() =>
  project.gitStatus.isRepository
  && Boolean(project.gitStatus.upstream)
  && ((project.gitStatus.ahead ?? 0) > 0 || (project.gitStatus.behind ?? 0) > 0)
)

const errorCount = computed(() =>
  diagnostics.value.reduce((total, payload) =>
    total + payload.diagnostics.filter((item) => item.severity === 1).length, 0)
)

const warningCount = computed(() =>
  diagnostics.value.reduce((total, payload) =>
    total + payload.diagnostics.filter((item) => item.severity === 2).length, 0)
)

const languageLabel = computed(() => {
  const path = editor.activeTab?.path
  if (!path) return ''
  const id = editorStatus.value?.languageId || resolveEditorLanguage(path)
  return formatLanguageLabel(id)
})

const cursorLabel = computed(() => {
  if (!editor.activeTab || editor.showDiff) return ''
  const status = editorStatus.value
  if (!status) return t('statusBar.cursor', { line: 1, column: 1 })
  return t('statusBar.cursor', { line: status.lineNumber, column: status.column })
})

const indentLabel = computed(() => {
  const status = editorStatus.value
  if (!status) return t('statusBar.spaces', { size: 2 })
  return status.insertSpaces
    ? t('statusBar.spaces', { size: status.indentSize })
    : t('statusBar.tabs', { size: status.indentSize })
})

const eolLabel = computed(() => editorStatus.value?.eol ?? 'LF')

onMounted(() => {
  unsubscribeStatus = subscribeEditorStatus((status) => {
    editorStatus.value = status
  })
  unsubscribeDiagnostics = subscribeDiagnostics((payloads) => {
    diagnostics.value = payloads
  })
})

onUnmounted(() => {
  unsubscribeStatus?.()
  unsubscribeDiagnostics?.()
})

function formatLanguageLabel(languageId: string): string {
  const labels: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    vue: 'Vue',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    markdown: 'Markdown',
    shellscript: 'Shell Script',
    yaml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    plaintext: 'Plain Text'
  }
  return labels[languageId] ?? languageId.charAt(0).toUpperCase() + languageId.slice(1)
}

function openProblems(): void {
  void terminal.show('problems')
}

function openSyncMenu(): void {
  void pullChanges()
}

async function pullChanges(): Promise<void> {
  const root = project.activeProject?.rootPath
  if (!root || !project.gitStatus.isRepository) return
  try {
    await unwrap(ipc.workspace.pullGit(root))
    await project.refreshGitBranch()
  } catch {
    // status bar stays quiet on sync errors; git panel shows details
  }
}

function toggleCodeAgent(): void {
  ui.toggleCodeAgentPanel()
}
</script>

<template>
  <footer class="editor-status-bar" role="status" aria-live="polite">
    <div class="status-left">
      <button
        v-if="project.gitStatus.isRepository && branchLabel"
        type="button"
        class="status-item"
        :title="t('branch.label')"
      >
        <GitBranch :size="11" />
        <span>{{ branchLabel }}</span>
      </button>

      <button
        v-if="showSync"
        type="button"
        class="status-item"
        :title="syncTooltip"
        @click="openSyncMenu"
      >
        <Cloud :size="11" />
      </button>

      <span v-if="workspaceName" class="status-item is-static" :title="workspaceName">
        {{ workspaceName }}
      </span>

      <button
        type="button"
        class="status-item status-problems"
        :title="t('lsp.problems')"
        @click="openProblems"
      >
        <XCircle :size="11" class="problem-icon error" />
        <span>{{ errorCount }}</span>
        <AlertTriangle :size="11" class="problem-icon warning" />
        <span>{{ warningCount }}</span>
      </button>

      <button
        type="button"
        class="status-item"
        :class="{ active: ui.codeAgentVisible }"
        :title="t('statusBar.codeAgent')"
        @click="toggleCodeAgent"
      >
        <Bot :size="11" />
      </button>
    </div>

    <div class="status-right">
      <button
        type="button"
        class="status-item"
        :class="{ active: ui.codeAgentVisible }"
        @click="toggleCodeAgent"
      >
        {{ t('statusBar.codeAgent') }}
      </button>

      <span v-if="cursorLabel" class="status-item is-static">{{ cursorLabel }}</span>
      <span class="status-item is-static">{{ indentLabel }}</span>
      <span class="status-item is-static">UTF-8</span>
      <span class="status-item is-static">{{ eolLabel }}</span>

      <button v-if="languageLabel" type="button" class="status-item status-language">
        <Braces :size="11" />
        <span>{{ languageLabel }}</span>
      </button>

      <button type="button" class="status-item status-bell" :title="t('statusBar.notifications')">
        <Bell :size="11" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.editor-status-bar {
  display: flex;
  height: 22px;
  flex-shrink: 0;
  align-items: stretch;
  justify-content: space-between;
  overflow: hidden;
  border-top: 1px solid var(--codex-border);
  background: var(--codex-editor-chrome, var(--codex-sidebar, #f3f3f3));
  color: var(--codex-text-secondary);
  font-size: 12px;
  line-height: 22px;
  user-select: none;
}

.status-left,
.status-right {
  display: flex;
  min-width: 0;
  align-items: stretch;
}

.status-item {
  display: inline-flex;
  height: 22px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.12s ease;
}

.status-item.is-static {
  cursor: default;
}

.status-item:hover:not(.is-static) {
  background: color-mix(in srgb, var(--codex-text) 6%, transparent);
}

.status-item.active {
  color: var(--codex-accent);
}

.status-problems .problem-icon.error {
  color: #e51400;
}

.status-problems .problem-icon.warning {
  color: #bf8803;
}

.status-language {
  text-transform: none;
}

.status-bell {
  padding: 0 10px;
}
</style>
