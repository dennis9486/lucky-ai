<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Ban,
  Check,
  ChevronRight,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  Loader2,
  Pencil,
  Plug,
  Search,
  TerminalSquare,
  Wrench,
  X
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ToolCallPart } from '../../../../shared/types/ai.js'
import { describeTool, isToolExpandedByDefault } from '../../../utils/tool-display.js'

const props = defineProps<{
  tool: ToolCallPart
}>()

const { t } = useI18n()
const open = ref(isToolExpandedByDefault(props.tool))

const ICONS = {
  file: FileText,
  pencil: Pencil,
  plus: FilePlus,
  search: Search,
  folder: FolderSearch,
  terminal: TerminalSquare,
  plug: Plug,
  wrench: Wrench,
  globe: Globe
} as const

const display = computed(() => describeTool(props.tool))
const icon = computed(() => ICONS[display.value.icon])
const hasBody = computed(() => Boolean(props.tool.output.trim() || props.tool.errorSummary || props.tool.recoverySuggestion))
const title = computed(() => [display.value.verb, display.value.target].filter(Boolean).join(' ') || props.tool.name)

function statusLabel(tool: ToolCallPart): string {
  switch (tool.status) {
    case 'running': return t('tool.statusRunning')
    case 'success': return t('tool.statusSuccess')
    case 'error': return t('tool.statusError')
    case 'rejected': return t('tool.statusRejected')
    default: return t('tool.statusPending')
  }
}
</script>

<template>
  <article class="tool-call-card" :class="`is-${tool.status}`">
    <button type="button" class="tool-call-head" :disabled="!hasBody" @click="open = !open">
      <ChevronRight :size="14" class="tool-call-chevron" :class="{ open, hidden: !hasBody }" />
      <component :is="icon" :size="15" :stroke-width="1.75" class="tool-call-icon" />
      <span class="tool-call-title">{{ title }}</span>
      <span class="tool-call-status" :class="`status-${tool.status}`">
        <Loader2 v-if="tool.status === 'running'" :size="13" class="spin" />
        <Check v-else-if="tool.status === 'success'" :size="13" :stroke-width="2.4" />
        <X v-else-if="tool.status === 'error'" :size="13" :stroke-width="2.4" />
        <Ban v-else-if="tool.status === 'rejected'" :size="13" :stroke-width="2" />
        <span>{{ statusLabel(tool) }}</span>
      </span>
    </button>
    <div v-if="open && hasBody" class="tool-call-body">
      <p v-if="tool.errorSummary" class="tool-call-error">{{ tool.errorSummary }}</p>
      <p v-if="tool.recoverySuggestion" class="tool-call-recovery">{{ tool.recoverySuggestion }}</p>
      <pre v-if="tool.output.trim()" class="tool-call-output pretty-scrollbar">{{ tool.output }}</pre>
    </div>
  </article>
</template>

<style scoped>
.tool-call-card {
  overflow: hidden;
  border: 1px solid var(--codex-border, #dadada);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
}
.tool-call-card.is-error {
  border-color: color-mix(in srgb, #dc2626 32%, var(--codex-border));
}
.tool-call-head {
  display: flex;
  min-height: 32px;
  width: 100%;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  padding: 6px 9px;
  text-align: left;
}
.tool-call-head:not(:disabled):hover {
  background: var(--codex-hover, #f2f2f2);
}
.tool-call-head:disabled {
  cursor: default;
}
.tool-call-chevron,
.tool-call-icon {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
}
.tool-call-chevron {
  transition: transform 0.14s ease, opacity 0.14s ease;
}
.tool-call-chevron.open {
  transform: rotate(90deg);
}
.tool-call-chevron.hidden {
  opacity: 0;
}
.tool-call-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--codex-text-secondary, #666);
  font-size: 12.5px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-call-status {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11.5px;
  font-weight: 600;
}
.status-running {
  color: var(--codex-accent, #2563eb);
}
.status-success {
  color: #159947;
}
.status-error {
  color: #dc2626;
}
.status-rejected {
  color: #d97706;
}
.tool-call-body {
  border-top: 1px solid var(--codex-border, #dadada);
  padding: 8px 10px;
  color: var(--codex-text-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}
.tool-call-error {
  margin: 0 0 6px;
  color: #dc2626;
}
.tool-call-recovery {
  margin: 0 0 6px;
  color: #9a5b0c;
}
.tool-call-output {
  max-height: 180px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
