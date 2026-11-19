<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from 'lucide-vue-next'
import type { DiffLine } from '../../utils/tool-display.js'
import { getFileIcon } from '../../utils/file-icons.js'
import { resolveBuiltinEditorLanguage } from '../../utils/editor-language.js'

const props = withDefaults(defineProps<{
  path: string
  lines: DiffLine[]
  defaultExpanded?: boolean
}>(), {
  defaultExpanded: true
})

const { t } = useI18n()
const expanded = ref(props.defaultExpanded)
const fileName = computed(() => props.path.split(/[/\\]/).filter(Boolean).pop() ?? (props.path || 'Untitled'))
const fileIcon = computed(() => getFileIcon(fileName.value))
const language = computed(() => resolveBuiltinEditorLanguage(props.path || fileName.value).toUpperCase())
const additions = computed(() => props.lines.filter((line) => line.kind === 'add').length)
const deletions = computed(() => props.lines.filter((line) => line.kind === 'del').length)
const previewLines = computed(() => {
  const max = 48
  if (props.lines.length <= max) return props.lines
  return props.lines.slice(0, max)
})
const truncatedCount = computed(() => Math.max(0, props.lines.length - previewLines.value.length))

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function highlightToken(token: string): string {
  if (/^(&quot;.*&quot;|'.*'|`.*`)$/.test(token)) return `<span class="tok-string">${token}</span>`
  if (/^(export|import|from|return|const|let|var|function|async|await|class|interface|type|if|else|for|while|new)$/.test(token)) {
    return `<span class="tok-keyword">${token}</span>`
  }
  if (/^(string|number|boolean|void|unknown|Record|Promise|Array)$/.test(token)) return `<span class="tok-type">${token}</span>`
  if (/^\d+(?:\.\d+)?$/.test(token)) return `<span class="tok-number">${token}</span>`
  if (/^[A-Za-z_$][\w$]*\($/.test(token)) {
    return `<span class="tok-fn">${token.slice(0, -1)}</span>(`
  }
  return token
}

function highlightCode(value: string): string {
  const html = escapeHtml(value)
  return html.replace(
    /(&quot;[^&]*?&quot;|'[^']*'|`[^`]*`|\b(?:export|import|from|return|const|let|var|function|async|await|class|interface|type|if|else|for|while|new|string|number|boolean|void|unknown|Record|Promise|Array)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*\()/g,
    highlightToken
  )
}
</script>

<template>
  <section class="code-diff-panel" :class="{ collapsed: !expanded }">
    <button type="button" class="code-diff-head" :aria-expanded="expanded" @click="expanded = !expanded">
      <ChevronRight :size="13" :stroke-width="2" class="code-diff-chevron" :class="{ open: expanded }" />
      <img v-if="fileIcon" :src="fileIcon" alt="" class="code-diff-icon" draggable="false" />
      <span v-else class="code-diff-lang">{{ language }}</span>
      <span class="code-diff-name" :title="path">{{ fileName }}</span>
      <span v-if="additions" class="code-diff-add">+{{ additions }}</span>
      <span v-if="deletions" class="code-diff-del">-{{ deletions }}</span>
    </button>

    <div v-show="expanded" class="code-diff-body pretty-scrollbar">
      <div
        v-for="(line, index) in previewLines"
        :key="`${index}-${line.kind}-${line.text}`"
        class="code-line"
        :class="`is-${line.kind}`"
      >
        <span class="code-line-sign">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : '' }}</span>
        <code class="code-line-text" v-html="highlightCode(line.text || ' ')" />
      </div>
      <div v-if="truncatedCount" class="code-line is-more">
        <span class="code-line-sign" />
        <code class="code-line-text">… {{ t('codeAgent.diffMoreLines', { count: truncatedCount }) }}</code>
      </div>
    </div>
  </section>
</template>

<style scoped>
.code-diff-panel {
  overflow: hidden;
  border: 1px solid var(--codex-border, #dcdcdc);
  border-radius: 11px;
  background: var(--codex-bg, #fafafa);
}

.code-diff-head {
  display: flex;
  min-height: 38px;
  width: 100%;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--codex-border, #dcdcdc);
  padding: 0 12px;
  color: var(--codex-text-secondary, #4a4a4a);
  text-align: left;
}

.code-diff-panel.collapsed .code-diff-head {
  border-bottom: 0;
}

.code-diff-chevron {
  flex: 0 0 auto;
  color: var(--codex-muted, #8a8a8a);
  transition: transform 0.14s ease;
}

.code-diff-chevron.open {
  transform: rotate(90deg);
}

.code-diff-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.code-diff-lang {
  min-width: 16px;
  color: #4b8aa1;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.code-diff-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--codex-text-secondary, #565656);
  font-size: 13.5px;
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-diff-add,
.code-diff-del {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 650;
  tab-size: 2;
}

.code-diff-add {
  color: #3f9b6b;
}

.code-diff-del {
  color: #dc486c;
}

.code-diff-body {
  max-height: 360px;
  overflow: auto;
  background:
    linear-gradient(to bottom, transparent calc(100% - 20px), var(--codex-bg, #fafafa)),
    var(--codex-bg, #fafafa);
  padding: 7px 0;
  font-family: var(--codex-code-font);
  font-size: 12.5px;
  line-height: 1.48;
  white-space: pre;
}

.code-line {
  position: relative;
  display: flex;
  min-width: max-content;
  padding-right: 18px;
  color: var(--codex-text, #1a1a1a);
}

.code-line::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  content: "";
}

.code-line.is-add {
  background: color-mix(in srgb, #3f9b6b 14%, transparent);
}

.code-line.is-add::before {
  background: color-mix(in srgb, #3f9b6b 70%, transparent);
}

.code-line.is-del {
  background: color-mix(in srgb, #dc486c 11%, transparent);
}

.code-line.is-del::before {
  background: color-mix(in srgb, #dc486c 70%, transparent);
}

.code-line.is-more {
  color: var(--codex-muted, #8a8a8a);
}

.code-line-sign {
  display: inline-flex;
  width: 22px;
  flex: 0 0 22px;
  justify-content: center;
  user-select: none;
  color: color-mix(in srgb, var(--codex-muted, #8a8a8a) 70%, transparent);
}

.code-line-text {
  display: block;
  min-width: 0;
}

.code-diff-body :deep(.tok-keyword) {
  color: #c00052;
}

.code-diff-body :deep(.tok-string) {
  color: #8d72d9;
}

.code-diff-body :deep(.tok-type) {
  color: #1f72aa;
}

.code-diff-body :deep(.tok-fn) {
  color: #df6b38;
}

.code-diff-body :deep(.tok-number) {
  color: #c83aa0;
}

.code-diff-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.code-diff-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--codex-muted, #8a8a8a) 35%, transparent);
}

.code-diff-panel.collapsed .code-diff-body {
  display: none;
}
</style>
