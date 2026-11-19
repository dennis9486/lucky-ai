<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  FileText, Pencil, FilePlus, Search, FolderSearch, TerminalSquare,
  Plug, Wrench, ChevronRight, Loader2, Check, X, Ban, Globe
} from 'lucide-vue-next'
import type { ToolCallPart } from '../../../shared/types/ai.js'
import { describeTool, buildDiff, isToolExpandedByDefault } from '../../utils/tool-display.js'
import { ansiToHtml } from '../../utils/ansi.js'
import CodeDiffPanel from './CodeDiffPanel.vue'

const props = defineProps<{ part: ToolCallPart; compact?: boolean }>()

const { t } = useI18n()

const display = computed(() => describeTool(props.part))
const diff = computed(() => buildDiff(props.part))
const isBash = computed(() => props.part.name === 'Bash')

const ICONS = {
  file: FileText, pencil: Pencil, plus: FilePlus, search: Search,
  folder: FolderSearch, terminal: TerminalSquare, plug: Plug, wrench: Wrench,
  globe: Globe
} as const
const IconComp = computed(() => ICONS[display.value.icon])

const hasBody = computed(() => Boolean(diff.value?.length) || Boolean(props.part.output.trim()))
const expanded = ref(isToolExpandedByDefault(props.part))
const hasRecovery = computed(() =>
  Boolean(props.part.errorSummary || props.part.recoverySuggestion || props.part.retryOf || props.part.retryAttempted)
)

const statusLabel = computed(() => {
  switch (props.part.status) {
    case 'running': return t('tool.statusRunning')
    case 'success': return t('tool.statusSuccess')
    case 'error': return t('tool.statusError')
    case 'rejected': return t('tool.statusRejected')
    default: return t('tool.statusPending')
  }
})

const MAX_OUTPUT = 4000
const outputText = computed(() => {
  const out = props.part.output
  if (out.length <= MAX_OUTPUT) return out
  return `${t('tool.truncated', { n: out.length - MAX_OUTPUT })}\n${out.slice(-MAX_OUTPUT)}`
})

const outputHtml = computed(() => ansiToHtml(outputText.value))

const titleText = computed(() => {
  if (display.value.target) {
    return `${display.value.verb} ${display.value.target}`
  }
  return display.value.verb
})
const diffPath = computed(() => {
  const input = props.part.input ?? {}
  for (const key of ['file_path', 'path', 'target_path', 'absolute_path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return display.value.target
})

function toggle(): void {
  if (hasBody.value) expanded.value = !expanded.value
}
</script>

<template>
  <div class="tool-card" :class="[`is-${part.status}`, { 'is-expanded': expanded && hasBody, 'is-compact': compact }]">
    <button type="button" class="tool-head" :disabled="!hasBody" @click="toggle">
      <ChevronRight
        :size="12"
        :stroke-width="2"
        class="chev"
        :class="{ open: expanded, hidden: !hasBody }"
      />
      <component :is="IconComp" :size="13" :stroke-width="1.75" class="tool-icon" />
      <span class="tool-title">{{ titleText }}</span>

      <span class="status" :class="`status-${part.status}`">
        <Loader2 v-if="part.status === 'running'" :size="12" :stroke-width="2" class="spin" />
        <Check v-else-if="part.status === 'success'" :size="12" :stroke-width="2.5" />
        <X v-else-if="part.status === 'error'" :size="12" :stroke-width="2.5" />
        <Ban v-else-if="part.status === 'rejected'" :size="12" :stroke-width="2" />
        <span class="status-text">{{ statusLabel }}</span>
      </span>
    </button>

    <div v-if="hasRecovery" class="recovery-strip">
      <span v-if="part.attempt && part.attempt > 1">{{ t('tool.retryAttempt', { n: part.attempt }) }}</span>
      <span v-if="part.retryAttempted">{{ t('tool.retryAttempted') }}</span>
      <span v-if="part.errorSummary">{{ part.errorSummary }}</span>
      <span v-if="part.recoverySuggestion">{{ part.recoverySuggestion }}</span>
    </div>

    <div v-if="expanded && hasBody" class="tool-body">
      <CodeDiffPanel v-if="diff?.length" :path="diffPath" :lines="diff" />

      <pre v-if="part.output.trim() && isBash" class="output pretty-scrollbar" v-html="outputHtml" />
      <pre v-else-if="part.output.trim()" class="output pretty-scrollbar">{{ outputText }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  @apply rounded-[10px] border border-codex-border bg-codex-bg overflow-hidden
         shadow-codex-card transition-colors;
}
.tool-card.is-error {
  @apply border-red-200/80 bg-red-50/20;
}
.tool-card.is-rejected {
  @apply border-amber-200/80 bg-amber-50/20;
}
.tool-card.is-expanded {
  @apply border-codex-border-hover;
}
.tool-card.is-compact {
  @apply rounded-lg border-codex-border bg-transparent shadow-none;
}
.tool-head {
  @apply w-full flex items-center gap-2 px-3 py-2 text-left min-h-[36px];
}
.tool-card.is-compact .tool-head {
  @apply min-h-[32px] px-2.5 py-1.5;
}
.tool-head:disabled {
  @apply cursor-default;
}
.tool-head:not(:disabled):hover {
  @apply bg-codex-hover;
}
.tool-card.is-compact .tool-head:not(:disabled):hover {
  @apply bg-codex-hover;
}
.chev {
  @apply text-codex-muted shrink-0 transition-transform duration-150;
}
.chev.open {
  @apply rotate-90;
}
.chev.hidden {
  @apply opacity-0 w-3;
}
.tool-icon {
  @apply text-codex-muted shrink-0;
}
.tool-title {
  @apply flex-1 min-w-0 truncate text-[11px] text-codex-text-secondary font-normal;
  font-family: var(--codex-code-font);
}
.tool-card.is-compact .tool-title {
  @apply text-[12px] text-codex-muted;
}
.status {
  @apply ml-2 flex items-center gap-1 shrink-0 text-[10px] font-medium;
}
.tool-card.is-compact .status {
  @apply text-[11px] font-medium;
}
.status-running {
  @apply text-codex-accent;
}
.status-success {
  @apply text-[#16a34a];
}
.status-error {
  @apply text-[#dc2626];
}
.status-rejected {
  @apply text-[#d97706];
}
.status-text {
  @apply leading-none;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.tool-body {
  @apply border-t border-codex-border bg-codex-hover;
}
.recovery-strip {
  @apply flex flex-col gap-1 border-t border-codex-border bg-amber-50/60 px-3 py-2
         text-[11px] font-medium leading-relaxed text-amber-800;
}
.tool-card.is-compact .recovery-strip {
  @apply bg-amber-50/35 px-2.5 py-1.5;
}
.tool-card.is-compact .tool-body {
  @apply bg-transparent;
}
.output {
  @apply font-mono text-[10px] leading-relaxed text-codex-text-secondary whitespace-pre-wrap break-words
         max-h-64 overflow-auto px-3 py-2.5 m-0;
  font-family: var(--codex-code-font);
}
</style>
