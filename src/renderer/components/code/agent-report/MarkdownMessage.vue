<script setup lang="ts">
import MarkdownContent from '../../common/MarkdownContent.vue'

defineProps<{
  source: string
  streaming?: boolean
}>()
</script>

<template>
  <MarkdownContent
    v-if="source.trim()"
    class="report-markdown"
    :source="source"
    :streaming="streaming"
  />
</template>

<style scoped>
.report-markdown {
  color: var(--codex-text, #202020);
}
.report-markdown :deep(.markdown-inner) {
  overflow-x: auto;
}
.report-markdown :deep(.markdown-inner table) {
  display: table;
  width: 100%;
  max-width: 100%;
  margin: 12px 0 14px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--codex-border, #d8d8d8) 86%, transparent);
  border-collapse: separate;
  border-spacing: 0;
  border-radius: 7px;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #202020);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: 1.5;
  table-layout: auto;
  word-break: normal;
  overflow-wrap: anywhere;
}
.report-markdown :deep(.markdown-inner table thead th) {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--codex-border, #d8d8d8) 86%, transparent);
  background: color-mix(in srgb, var(--codex-hover, #f2f2f2) 78%, var(--codex-bg, #fff));
  color: var(--codex-text, #202020);
  font-weight: 680;
}
.report-markdown :deep(.markdown-inner table th),
.report-markdown :deep(.markdown-inner table td) {
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--codex-border, #d8d8d8) 82%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--codex-border, #d8d8d8) 82%, transparent);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  color: var(--codex-text, #202020);
}
.report-markdown :deep(.markdown-inner table th:last-child),
.report-markdown :deep(.markdown-inner table td:last-child) {
  border-right: 0;
}
.report-markdown :deep(.markdown-inner table tbody tr:last-child td) {
  border-bottom: 0;
}
.report-markdown :deep(.markdown-inner table tbody tr:nth-child(even) td) {
  background: transparent;
}
.report-markdown :deep(.markdown-inner table tbody tr:hover td) {
  background: color-mix(in srgb, var(--codex-hover, #f2f2f2) 52%, transparent);
}
.report-markdown :deep(.markdown-inner table th:first-child),
.report-markdown :deep(.markdown-inner table td:first-child) {
  width: 1%;
  white-space: nowrap;
  font-weight: 620;
}
.report-markdown :deep(.markdown-inner table :not(.code-block) > code) {
  display: inline;
  max-width: 100%;
  border: 1px solid color-mix(in srgb, var(--codex-accent, #2563eb) 10%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 10%, var(--codex-bg, #fff));
  color: var(--codex-accent, #2563eb);
  padding: 1px 6px;
  font-size: 0.88em;
  font-weight: 500;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
