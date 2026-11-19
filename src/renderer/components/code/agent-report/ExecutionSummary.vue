<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { AgentReportStats } from './report-types.js'

const props = defineProps<{
  stats: AgentReportStats
  detailsCount?: number
}>()

const { t } = useI18n()
const expanded = ref(false)

const summary = computed(() => {
  const items: string[] = []
  if (props.stats.files) items.push(t('codeAgent.exploredFiles', { count: props.stats.files }))
  if (props.stats.searches) items.push(t('codeAgent.exploredSearches', { count: props.stats.searches }))
  if (props.stats.fetches) items.push(t('codeAgent.exploredFetches', { count: props.stats.fetches }))
  if (props.stats.commands) items.push(t('codeAgent.exploredCommands', { count: props.stats.commands }))
  if (props.stats.edits) items.push(t('codeAgent.exploredEdits', { count: props.stats.edits }))
  if (props.stats.failed) items.push(t('codeAgent.report.failedTools', { count: props.stats.failed }))
  return items.length ? t('codeAgent.exploredSummary', { items: items.join(', ') }) : ''
})
</script>

<template>
  <section v-if="summary" class="execution-summary">
    <button type="button" class="summary-toggle" @click="expanded = !expanded">
      <span>{{ summary }}</span>
      <ChevronRight :size="14" class="summary-chevron" :class="{ open: expanded }" />
    </button>
    <div v-if="expanded" class="summary-details">
      <span>{{ t('codeAgent.report.toolCalls', { count: detailsCount ?? 0 }) }}</span>
    </div>
  </section>
</template>

<style scoped>
.execution-summary {
  color: var(--codex-text-secondary, #6d6d6d);
}
.summary-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
}
.summary-toggle:hover {
  color: var(--codex-text, #202020);
}
.summary-chevron {
  transition: transform 0.14s ease;
}
.summary-chevron.open {
  transform: rotate(90deg);
}
.summary-details {
  margin-top: 6px;
  color: var(--codex-muted, #8f8f8f);
  font-size: 12px;
}
</style>
