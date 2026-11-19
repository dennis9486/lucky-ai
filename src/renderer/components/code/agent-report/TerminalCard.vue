<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, TerminalSquare } from 'lucide-vue-next'
import type { ToolCallPart } from '../../../../shared/types/ai.js'
import { ansiToHtml } from '../../../utils/ansi.js'

/** 终端输出的最大渲染字符数，超出则只保留尾部，避免超长输出撑爆 DOM */
const MAX_OUTPUT = 4000

const props = defineProps<{
  tool: ToolCallPart
}>()

const { t } = useI18n()
const open = ref(props.tool.status === 'running' || props.tool.status === 'error')

const command = computed(() => {
  const input = props.tool.input ?? {}
  return typeof input.command === 'string' ? input.command : props.tool.name
})

/**
 * 终端输出可能包含 ANSI 转义码（颜色/光标控制），直接以文本渲染会显示成乱码。
 * 这里统一经 ansiToHtml 转为带内联样式的安全 HTML（已转义 HTML，可安全用于 v-html）。
 */
const outputHtml = computed(() => {
  const text = props.tool.output
  const body = text.length <= MAX_OUTPUT
    ? text
    : `${t('tool.truncated', { n: text.length - MAX_OUTPUT })}\n${text.slice(-MAX_OUTPUT)}`
  return ansiToHtml(body)
})
</script>

<template>
  <article class="terminal-card">
    <button type="button" class="terminal-head" @click="open = !open">
      <ChevronRight :size="14" class="terminal-chevron" :class="{ open }" />
      <TerminalSquare :size="15" :stroke-width="1.8" class="terminal-icon" />
      <span class="terminal-title">{{ command }}</span>
    </button>
    <pre v-if="open && tool.output.trim()" class="terminal-output pretty-scrollbar" v-html="outputHtml" />
  </article>
</template>

<style scoped>
.terminal-card {
  overflow: hidden;
  border: 1px solid var(--codex-border, #dadada);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
}
.terminal-head {
  display: flex;
  min-height: 32px;
  width: 100%;
  align-items: center;
  gap: 7px;
  border: 0;
  background: color-mix(in srgb, var(--codex-bg, #fff) 88%, var(--codex-hover, #f2f2f2));
  padding: 6px 9px;
  text-align: left;
}
.terminal-head:hover {
  background: var(--codex-hover, #f2f2f2);
}
.terminal-chevron {
  color: var(--codex-muted, #8a8a8a);
  transition: transform 0.14s ease;
}
.terminal-chevron.open {
  transform: rotate(90deg);
}
.terminal-icon {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
}
.terminal-title {
  min-width: 0;
  overflow: hidden;
  color: var(--codex-text-secondary, #666);
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-output {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  border-top: 1px solid var(--codex-border, #dadada);
  padding: 8px 10px;
  color: var(--codex-text-secondary, #666);
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
