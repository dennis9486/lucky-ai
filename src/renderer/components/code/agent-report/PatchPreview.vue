<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiffLine } from '../../../utils/tool-display.js'

/** 预览最多渲染的行数；超出仅提示剩余行数，避免整文件 Write 产生上千 DOM 节点拖慢报告 */
const MAX_PREVIEW_LINES = 80

const props = defineProps<{
  lines: DiffLine[]
}>()

const { t } = useI18n()
const visibleLines = computed(() => props.lines.slice(0, MAX_PREVIEW_LINES))
const hiddenCount = computed(() => Math.max(0, props.lines.length - visibleLines.value.length))

function classFor(kind: DiffLine['kind']): string {
  if (kind === 'add') return 'is-add'
  if (kind === 'del') return 'is-del'
  return 'is-context'
}

function prefixFor(kind: DiffLine['kind']): string {
  if (kind === 'add') return '+'
  if (kind === 'del') return '-'
  return ' '
}
</script>

<template>
  <div class="patch-preview-wrap">
    <pre class="patch-preview pretty-scrollbar"><code><span
      v-for="(line, index) in visibleLines"
      :key="`${index}-${line.kind}`"
      class="patch-line"
      :class="classFor(line.kind)"
    ><span class="line-prefix">{{ prefixFor(line.kind) }}</span>{{ line.text || ' ' }}</span></code></pre>
    <div v-if="hiddenCount" class="patch-more">{{ t('codeAgent.diffMoreLines', { count: hiddenCount }) }}</div>
  </div>
</template>

<style scoped>
.patch-preview {
  max-height: 150px;
  overflow: auto;
  margin: 0;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #222);
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.45;
}
.patch-line {
  display: block;
  min-height: 17px;
  padding: 0 9px;
  white-space: pre;
}
.line-prefix {
  display: inline-block;
  width: 14px;
  user-select: none;
  color: var(--codex-muted, #999);
}
.patch-line.is-add {
  border-left: 2px solid #62b388;
  background: color-mix(in srgb, #62b388 16%, transparent);
}
.patch-line.is-del {
  border-left: 2px solid #df7892;
  background: color-mix(in srgb, #df7892 14%, transparent);
}
.patch-line.is-context {
  color: var(--codex-text-secondary, #666);
}
.patch-more {
  border-top: 1px solid var(--codex-border, #e3e3e3);
  padding: 4px 9px;
  color: var(--codex-muted, #999);
  font-size: 11px;
}
</style>
