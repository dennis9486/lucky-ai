<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LspDiagnostic, LspDiagnosticsPayload } from '../../../shared/types/lsp.js'
import { listDiagnostics, subscribeDiagnostics } from '../../services/lsp-client.service.js'
import { useEditorStore } from '../../stores/editor.store.js'
import LspStatusBadge from '../editor/LspStatusBadge.vue'

const { t } = useI18n()
const editor = useEditorStore()
const diagnostics = ref<LspDiagnosticsPayload[]>(listDiagnostics())
let unsubscribe: (() => void) | null = null

interface ProblemRow {
  path: string
  fileName: string
  diagnostic: LspDiagnostic
}

const rows = computed<ProblemRow[]>(() =>
  diagnostics.value.flatMap((payload) =>
    payload.diagnostics.map((diagnostic) => ({
      path: payload.path,
      fileName: payload.path.split(/[/\\]/).pop() ?? payload.path,
      diagnostic
    }))
  )
)

onMounted(() => {
  unsubscribe = subscribeDiagnostics((payloads) => {
    diagnostics.value = payloads
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

function severityLabel(severity: number): string {
  switch (severity) {
    case 1: return t('bottomPanel.severityError')
    case 2: return t('bottomPanel.severityWarning')
    case 3: return t('bottomPanel.severityInfo')
    default: return t('bottomPanel.severityHint')
  }
}

function severityClass(severity: number): string {
  switch (severity) {
    case 1: return 'is-error'
    case 2: return 'is-warning'
    case 3: return 'is-info'
    default: return 'is-hint'
  }
}

function openProblem(row: ProblemRow): void {
  void editor.openFile(row.path, {
    lineNumber: row.diagnostic.startLineNumber,
    column: row.diagnostic.startColumn
  })
}
</script>

<template>
  <div class="panel-problems">
    <div class="panel-problems-status"><LspStatusBadge variant="full" /></div>
    <div v-if="rows.length" class="problem-list pretty-scrollbar">
      <button
        v-for="(row, index) in rows"
        :key="`${row.path}:${row.diagnostic.startLineNumber}:${row.diagnostic.startColumn}:${index}`"
        type="button"
        class="problem-row"
        @click="openProblem(row)"
      >
        <span class="problem-severity" :class="severityClass(row.diagnostic.severity)">
          {{ severityLabel(row.diagnostic.severity) }}
        </span>
        <span class="problem-message">{{ row.diagnostic.message }}</span>
        <span class="problem-meta">
          {{ row.fileName }}:{{ row.diagnostic.startLineNumber }}:{{ row.diagnostic.startColumn }}
        </span>
      </button>
    </div>
    <p v-else class="panel-empty">{{ t('bottomPanel.noProblems') }}</p>
  </div>
</template>

<style scoped>
.panel-problems {
  @apply flex h-full min-h-0 flex-col;
}
.panel-problems-status {
  @apply flex shrink-0 items-center gap-2 border-b px-3 py-1.5;
  border-color: color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.panel-problems-status:empty {
  display: none;
}
.problem-list {
  @apply min-h-0 flex-1 overflow-auto;
}
.problem-row {
  @apply flex w-full items-center gap-3 border-b px-3 py-1.5 text-left text-[12px]
         transition-colors hover:bg-codex-hover;
  border-color: color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.problem-severity {
  @apply w-14 shrink-0 font-semibold;
}
.problem-severity.is-error { @apply text-red-600; }
.problem-severity.is-warning { @apply text-amber-600; }
.problem-severity.is-info { @apply text-sky-600; }
.problem-severity.is-hint { @apply text-codex-muted; }
.problem-message {
  @apply min-w-0 flex-1 truncate text-codex-text;
}
.problem-meta {
  @apply shrink-0 font-mono text-[11px] text-codex-muted;
}
.panel-empty {
  @apply flex min-h-0 flex-1 items-center justify-center px-4 text-[12px] text-codex-muted;
}
</style>
