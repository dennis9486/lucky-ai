<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, AlertTriangle, CircleDot, FileText, Loader2, Wrench } from 'lucide-vue-next'
import type { LspDiagnosticsPayload, LspDiagnostic } from '../../../shared/types/lsp.js'
import {
  listDiagnostics,
  requestCodeActions,
  applyCodeAction,
  subscribeDiagnostics,
  type LspCodeActionItem
} from '../../services/lsp-client.service.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { getFileIcon } from '../../utils/file-icons.js'

const { t } = useI18n()
const editor = useEditorStore()
const project = useProjectStore()
const payloads = ref<LspDiagnosticsPayload[]>(listDiagnostics())
const failedIcons = ref(new Set<string>())
const loadingActionKey = ref<string | null>(null)
const applyingActionKey = ref<string | null>(null)
const actionResults = ref<Record<string, LspCodeActionItem[]>>({})
const actionErrors = ref<Record<string, string>>({})
let unsubscribe: (() => void) | null = null

const total = computed(() => payloads.value.reduce((sum, payload) => sum + payload.diagnostics.length, 0))

onMounted(() => {
  unsubscribe = subscribeDiagnostics((next) => {
    payloads.value = next
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

function displayName(path: string): string {
  return path.split('/').pop() ?? path
}

function getIcon(path: string): string {
  return failedIcons.value.has(path) ? '' : getFileIcon(path)
}

function fallbackIcon(path: string): void {
  failedIcons.value = new Set([...failedIcons.value, path])
}

function severityClass(diagnostic: LspDiagnostic): string {
  if (diagnostic.severity === 1) return 'error'
  if (diagnostic.severity === 2) return 'warning'
  if (diagnostic.severity === 3) return 'info'
  return 'hint'
}

function openDiagnostic(path: string, diagnostic: LspDiagnostic): void {
  void editor.openFile(path, {
    lineNumber: diagnostic.startLineNumber,
    column: diagnostic.startColumn,
    endColumn: diagnostic.endColumn
  })
}

function diagnosticKey(path: string, diagnostic: LspDiagnostic): string {
  return `${path}:${diagnostic.startLineNumber}:${diagnostic.startColumn}:${diagnostic.message}`
}

async function loadCodeActions(path: string, diagnostic: LspDiagnostic): Promise<void> {
  const key = diagnosticKey(path, diagnostic)
  if (loadingActionKey.value === key) return
  if (actionResults.value[key]) {
    actionResults.value = omitKey(actionResults.value, key)
    actionErrors.value = omitKey(actionErrors.value, key)
    return
  }
  loadingActionKey.value = key
  actionErrors.value = omitKey(actionErrors.value, key)
  try {
    actionResults.value = {
      ...actionResults.value,
      [key]: await requestCodeActions(path, diagnostic)
    }
  } catch (e) {
    actionErrors.value = {
      ...actionErrors.value,
      [key]: e instanceof Error ? e.message : String(e)
    }
  } finally {
    loadingActionKey.value = null
  }
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

async function runCodeAction(path: string, diagnostic: LspDiagnostic, action: LspCodeActionItem): Promise<void> {
  const key = `${diagnosticKey(path, diagnostic)}:${action.title}`
  if (applyingActionKey.value === key || action.disabled) return
  applyingActionKey.value = key
  try {
    await applyCodeAction(path, action, project.activeProject?.rootPath)
    actionResults.value = omitKey(actionResults.value, diagnosticKey(path, diagnostic))
  } catch (e) {
    actionErrors.value = {
      ...actionErrors.value,
      [diagnosticKey(path, diagnostic)]: e instanceof Error ? e.message : String(e)
    }
  } finally {
    applyingActionKey.value = null
  }
}
</script>

<template>
  <section class="problems-panel">
    <header class="problems-header">
      <span>{{ t('lsp.problems') }}</span>
      <strong>{{ total }}</strong>
    </header>

    <div v-if="payloads.length" class="problems-list pretty-scrollbar">
      <section v-for="payload in payloads" :key="payload.path" class="problem-file">
        <div class="problem-file-head">
          <img
            v-if="getIcon(payload.path)"
            class="problem-icon"
            :src="getIcon(payload.path)"
            alt=""
            @error="fallbackIcon(payload.path)"
          />
          <FileText v-else :size="15" class="problem-fallback" />
          <span>{{ displayName(payload.path) }}</span>
          <strong>{{ payload.diagnostics.length }}</strong>
        </div>
        <div
          v-for="diagnostic in payload.diagnostics"
          :key="`${diagnostic.startLineNumber}:${diagnostic.startColumn}:${diagnostic.message}`"
          class="problem-entry"
        >
          <div
            role="button"
            tabindex="0"
            class="problem-row"
            @click="openDiagnostic(payload.path, diagnostic)"
            @keydown.enter.prevent="openDiagnostic(payload.path, diagnostic)"
            @keydown.space.prevent="openDiagnostic(payload.path, diagnostic)"
          >
            <AlertCircle v-if="diagnostic.severity === 1" :size="14" />
            <AlertTriangle v-else-if="diagnostic.severity === 2" :size="14" />
            <CircleDot v-else :size="13" />
            <span class="problem-message" :class="severityClass(diagnostic)">{{ diagnostic.message }}</span>
            <button
              type="button"
              class="problem-action"
              :title="t('lsp.codeActions')"
              @click.stop="loadCodeActions(payload.path, diagnostic)"
            >
              <Loader2
                v-if="loadingActionKey === diagnosticKey(payload.path, diagnostic)"
                :size="13"
                class="spin"
              />
              <Wrench v-else :size="13" />
            </button>
            <span class="problem-line">{{ diagnostic.startLineNumber }}</span>
          </div>
          <div
            v-if="actionResults[diagnosticKey(payload.path, diagnostic)] || actionErrors[diagnosticKey(payload.path, diagnostic)]"
            class="code-actions"
          >
            <p v-if="actionErrors[diagnosticKey(payload.path, diagnostic)]">
              {{ actionErrors[diagnosticKey(payload.path, diagnostic)] }}
            </p>
            <p v-else-if="!actionResults[diagnosticKey(payload.path, diagnostic)]?.length">
              {{ t('lsp.noCodeActions') }}
            </p>
            <button
              v-for="action in actionResults[diagnosticKey(payload.path, diagnostic)] ?? []"
              :key="`${action.title}:${action.kind ?? ''}`"
              type="button"
              :disabled="Boolean(action.disabled) || applyingActionKey === `${diagnosticKey(payload.path, diagnostic)}:${action.title}`"
              :title="action.disabled?.reason"
              @click="runCodeAction(payload.path, diagnostic, action)"
            >
              <Wrench :size="12" />
              <span>{{ action.title }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="problems-empty">
      <CircleDot :size="24" />
      <p>{{ t('lsp.noProblems') }}</p>
      <small>{{ t('lsp.problemsHint') }}</small>
    </div>
  </section>
</template>

<style scoped>
.problems-panel {
  @apply flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-codex-sidebar text-codex-text;
}
.problems-header {
  @apply flex h-10 shrink-0 items-center justify-between border-b border-codex-border px-3 text-[13px] font-bold uppercase tracking-wide;
}
.problems-header strong {
  @apply text-[12px] text-codex-text-secondary;
}
.problems-list {
  @apply min-h-0 flex-1 overflow-y-auto overflow-x-hidden;
  scrollbar-width: thin;
}
.problem-file {
  @apply border-b border-codex-border;
}
.problem-file-head {
  @apply flex h-8 items-center gap-1.5 px-3 text-[13px] font-semibold text-codex-text-secondary;
}
.problem-file-head span {
  @apply min-w-0 flex-1 truncate;
}
.problem-file-head strong {
  @apply rounded-md bg-codex-hover px-1.5 py-0.5 text-[11px] text-codex-text-secondary;
}
.problem-icon {
  @apply h-4 w-4 shrink-0 object-contain;
}
.problem-fallback {
  @apply shrink-0 text-codex-muted;
}
.problem-entry {
  @apply min-w-0;
}
.problem-row {
  @apply flex w-full items-center gap-2 px-7 py-1.5 text-left text-[12px] font-medium text-codex-text-secondary
         outline-none transition-colors hover:bg-codex-hover hover:text-codex-text focus-visible:bg-codex-hover;
}
.problem-message {
  @apply min-w-0 flex-1 truncate;
}
.problem-message.error {
  @apply text-red-600;
}
.problem-message.warning {
  @apply text-amber-600;
}
.problem-line {
  @apply shrink-0 tabular-nums text-codex-muted;
}
.problem-action {
  @apply hidden h-5 w-5 shrink-0 items-center justify-center rounded text-codex-text-secondary transition-colors
         hover:bg-codex-bg hover:text-codex-text;
}
.problem-row:hover .problem-action,
.problem-row:focus-within .problem-action {
  @apply flex;
}
.code-actions {
  @apply ml-12 mr-3 mb-1.5 rounded-md px-2 py-1.5 text-[12px];
  background: color-mix(in srgb, var(--codex-bg) 70%, var(--codex-sidebar));
}
.code-actions p {
  @apply px-1 py-1 text-codex-text-secondary;
}
.code-actions button {
  @apply flex min-h-7 w-full items-center gap-2 rounded px-1.5 text-left text-codex-text-secondary transition-colors
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-50;
}
.code-actions button span {
  @apply min-w-0 truncate;
}
.spin {
  animation: lsp-spin 0.9s linear infinite;
}
.problems-empty {
  @apply flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center text-codex-text-secondary;
}
.problems-empty p {
  @apply text-[13px] font-semibold text-codex-text;
}
.problems-empty small {
  @apply text-[12px] leading-relaxed;
}
@keyframes lsp-spin {
  to { transform: rotate(360deg); }
}
</style>
