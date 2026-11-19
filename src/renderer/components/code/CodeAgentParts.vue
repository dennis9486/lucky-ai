<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
import type { MessagePart, ToolCallPart } from '../../../shared/types/ai.js'
import MarkdownContent from '../common/MarkdownContent.vue'
import CodeDiffPanel from '../home/CodeDiffPanel.vue'
import { ansiToHtml } from '../../utils/ansi.js'
import { buildDiff, describeTool, isToolExpandedByDefault } from '../../utils/tool-display.js'

const props = defineProps<{
  parts: MessagePart[]
  live?: boolean
}>()

const { t } = useI18n()
const processExpanded = ref(false)
const processStartedAt = ref<number | null>(null)
const now = ref(Date.now())
const expandedTools = ref<Record<string, boolean>>({})
let timer: ReturnType<typeof setInterval> | null = null

type Segment =
  | { kind: 'text' | 'thinking'; part: MessagePart; index: number }
  | { kind: 'tools'; parts: ToolCallPart[]; index: number }

const segments = computed(() => buildSegments(props.parts))
const answerSegments = computed(() => segments.value.filter((segment) => segment.kind === 'text'))
const processSegments = computed(() => segments.value.filter((segment) => segment.kind !== 'text'))
const showProcess = computed(() => processSegments.value.length > 0)
const processState = computed<'thinking' | 'tools' | 'done'>(() => {
  const hasActiveTool = processSegments.value.some((segment) =>
    segment.kind === 'tools'
    && segment.parts.some((tool) => tool.status === 'pending' || tool.status === 'running')
  )
  if (hasActiveTool) return 'tools'

  const lastPart = props.parts[props.parts.length - 1]
  if (props.live && lastPart?.type === 'thinking') return 'thinking'

  return 'done'
})
const processLabel = computed(() => {
  switch (processState.value) {
    case 'tools': return t('thinking.processTools')
    case 'thinking': return t('thinking.processThinking')
    default: return t('thinking.processDone')
  }
})
const elapsedLabel = computed(() => {
  if (!processStartedAt.value) return ''
  const sec = Math.max(1, Math.round((now.value - processStartedAt.value) / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
})

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

watch(
  showProcess,
  (visible) => {
    if (!visible) {
      processExpanded.value = false
      processStartedAt.value = null
      stopTimer()
      return
    }
    processExpanded.value = false
    if (!props.live) {
      processStartedAt.value = null
      stopTimer()
      return
    }
    const started = processStartedAt.value ?? Date.now()
    processStartedAt.value = started
    now.value = started
    if (!timer) {
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)

onUnmounted(stopTimer)

function buildSegments(parts: MessagePart[]): Segment[] {
  const result: Segment[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]!
    if (part.type === 'tool') {
      const tools: ToolCallPart[] = []
      const start = i
      while (i < parts.length && parts[i]!.type === 'tool') {
        tools.push(parts[i] as ToolCallPart)
        i++
      }
      result.push({ kind: 'tools', parts: tools, index: start })
      continue
    }
    result.push({ kind: part.type, part, index: i })
    i++
  }
  return result
}

function isStreamingPart(index: number, part: MessagePart): boolean {
  return Boolean(props.live && index === props.parts.length - 1 && (part.type === 'text' || part.type === 'thinking'))
}

function toolIcon(tool: ToolCallPart): unknown {
  return ICONS[describeTool(tool).icon]
}

function toolTitle(tool: ToolCallPart): string {
  const display = describeTool(tool)
  return [display.verb, display.target].filter(Boolean).join(' ') || tool.name
}

function toolStatusLabel(tool: ToolCallPart): string {
  switch (tool.status) {
    case 'running': return t('tool.statusRunning')
    case 'success': return t('tool.statusSuccess')
    case 'error': return t('tool.statusError')
    case 'rejected': return t('tool.statusRejected')
    default: return t('tool.statusPending')
  }
}

function toolHasBody(tool: ToolCallPart): boolean {
  return Boolean(buildDiff(tool)?.length) || Boolean(tool.output.trim())
}

function isToolExpanded(tool: ToolCallPart): boolean {
  if (!toolHasBody(tool)) return false
  const explicit = expandedTools.value[tool.id]
  if (explicit !== undefined) return explicit
  return isToolExpandedByDefault(tool)
}

function toggleTool(tool: ToolCallPart): void {
  if (!toolHasBody(tool)) return
  expandedTools.value = {
    ...expandedTools.value,
    [tool.id]: !isToolExpanded(tool)
  }
}

function toolBodyText(tool: ToolCallPart): string {
  const max = 4000
  if (tool.output.length <= max) return tool.output
  return `${t('tool.truncated', { n: tool.output.length - max })}\n${tool.output.slice(-max)}`
}

function toolBodyHtml(tool: ToolCallPart): string {
  return ansiToHtml(toolBodyText(tool))
}

function toolDiffPath(tool: ToolCallPart): string {
  const input = tool.input ?? {}
  for (const key of ['file_path', 'path', 'target_path', 'absolute_path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return describeTool(tool).target
}

function toolGroupSummary(tools: ToolCallPart[]): string {
  const reads = tools.filter((tool) => ['Read', 'Glob'].includes(tool.name)).length
  const searches = tools.filter((tool) => ['Grep', 'WebSearch'].includes(tool.name)).length
  const fetches = tools.filter((tool) => ['WebFetch', 'WebCrawl'].includes(tool.name)).length
  const runs = tools.filter((tool) => tool.name === 'Bash').length
  const edits = tools.filter((tool) => ['Write', 'Edit', 'MultiEdit'].includes(tool.name)).length
  const parts: string[] = []
  if (reads) parts.push(t('codeAgent.exploredFiles', { count: reads }))
  if (searches) parts.push(t('codeAgent.exploredSearches', { count: searches }))
  if (fetches) parts.push(t('codeAgent.exploredFetches', { count: fetches }))
  if (runs) parts.push(t('codeAgent.exploredCommands', { count: runs }))
  if (edits) parts.push(t('codeAgent.exploredEdits', { count: edits }))
  return parts.length ? t('codeAgent.exploredSummary', { items: parts.join(', ') }) : ''
}

function segmentKey(segment: Segment): string {
  if (segment.kind === 'tools') return `tools-${segment.index}-${segment.parts.map((p) => p.id).join('-')}`
  return `${segment.kind}-${segment.index}`
}

function stopTimer(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
</script>

<template>
  <div class="code-agent-parts">
    <div v-if="showProcess" class="process-block">
      <button type="button" class="process-toggle" @click="processExpanded = !processExpanded">
        <span>{{ processLabel }}</span>
        <span v-if="elapsedLabel" class="process-time">{{ elapsedLabel }}</span>
        <ChevronRight :size="13" class="process-chev" :class="{ open: processExpanded }" />
      </button>

      <Transition name="process-expand">
        <div v-if="processExpanded" class="process-body">
          <template v-for="segment in processSegments" :key="segmentKey(segment)">
            <MarkdownContent
              v-if="segment.kind === 'thinking' && segment.part.type === 'thinking' && segment.part.text.trim()"
              class="thinking-content"
              :source="segment.part.text"
              :streaming="isStreamingPart(segment.index, segment.part)"
              variant="thinking"
            />
            <div v-else-if="segment.kind === 'tools'" class="tool-log-group">
              <div v-if="toolGroupSummary(segment.parts)" class="tool-group-summary">
                {{ toolGroupSummary(segment.parts) }}
              </div>
              <div class="tool-log-list">
                <article
                  v-for="tool in segment.parts"
                  :key="tool.id"
                  class="tool-log-card"
                  :class="[`is-${tool.status}`, { 'is-open': isToolExpanded(tool) }]"
                >
                  <button
                    type="button"
                    class="tool-log-head"
                    :disabled="!toolHasBody(tool)"
                    @click="toggleTool(tool)"
                  >
                    <ChevronRight
                      :size="14"
                      class="tool-log-chevron"
                      :class="{ open: isToolExpanded(tool), hidden: !toolHasBody(tool) }"
                    />
                    <component :is="toolIcon(tool)" :size="15" :stroke-width="1.75" class="tool-log-icon" />
                    <span class="tool-log-title">{{ toolTitle(tool) }}</span>
                    <span class="tool-log-status" :class="`status-${tool.status}`">
                      <Loader2 v-if="tool.status === 'running'" :size="13" class="spin" />
                      <Check v-else-if="tool.status === 'success'" :size="13" :stroke-width="2.4" />
                      <X v-else-if="tool.status === 'error'" :size="13" :stroke-width="2.4" />
                      <Ban v-else-if="tool.status === 'rejected'" :size="13" :stroke-width="2" />
                      <span>{{ toolStatusLabel(tool) }}</span>
                    </span>
                  </button>

                  <div
                    v-if="tool.errorSummary || tool.recoverySuggestion || tool.retryAttempted"
                    class="tool-recovery"
                  >
                    <span v-if="tool.attempt && tool.attempt > 1">{{ t('tool.retryAttempt', { n: tool.attempt }) }}</span>
                    <span v-if="tool.retryAttempted">{{ t('tool.retryAttempted') }}</span>
                    <span v-if="tool.errorSummary">{{ tool.errorSummary }}</span>
                    <span v-if="tool.recoverySuggestion">{{ tool.recoverySuggestion }}</span>
                  </div>

                  <div v-if="isToolExpanded(tool)" class="tool-log-body">
                    <CodeDiffPanel
                      v-if="buildDiff(tool)?.length"
                      :path="toolDiffPath(tool)"
                      :lines="buildDiff(tool) ?? []"
                    />
                    <pre
                      v-if="tool.output.trim() && tool.name === 'Bash'"
                      class="tool-output pretty-scrollbar"
                      v-html="toolBodyHtml(tool)"
                    />
                    <pre v-else-if="tool.output.trim()" class="tool-output pretty-scrollbar">{{ toolBodyText(tool) }}</pre>
                  </div>
                </article>
              </div>
            </div>
          </template>
        </div>
      </Transition>
    </div>

    <template v-for="segment in answerSegments" :key="segmentKey(segment)">
      <MarkdownContent
        v-if="segment.kind === 'text' && segment.part.type === 'text' && segment.part.text.trim()"
        :source="segment.part.text"
        :streaming="isStreamingPart(segment.index, segment.part)"
      />
    </template>
  </div>
</template>

<style scoped>
.code-agent-parts {
  @apply flex flex-col gap-3 text-codex-text;
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.process-block {
  @apply border-b border-codex-border;
  padding-bottom: 10px;
}
.process-toggle {
  @apply flex w-full items-center gap-1.5 py-1.5 text-left font-medium text-codex-muted hover:text-codex-text-secondary;
  font-size: var(--code-agent-content-size, 12.5px);
}
.process-time {
  @apply tabular-nums;
}
.process-chev {
  @apply ml-auto text-codex-muted transition-transform;
}
.process-chev.open {
  @apply rotate-90;
}
.process-body {
  @apply flex flex-col gap-3 py-2;
}
.thinking-content {
  @apply border-l border-codex-border pl-3 text-codex-text-secondary;
}
.tool-log-group {
  @apply flex flex-col gap-2;
}
.tool-group-summary {
  color: var(--codex-text-secondary, #6d6d6d);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: 1.45;
}
.tool-log-list {
  @apply flex flex-col gap-2;
}
.tool-log-card {
  overflow: hidden;
  border: 1px solid var(--codex-border, #dcdcdc);
  border-radius: 10px;
  background: color-mix(in srgb, var(--codex-bg, #fff) 82%, var(--codex-hover, #f0f0f0));
}
.tool-log-card.is-error {
  border-color: color-mix(in srgb, #dc2626 26%, var(--codex-border));
  background: color-mix(in srgb, #dc2626 4%, var(--codex-bg));
}
.tool-log-card.is-running {
  border-color: color-mix(in srgb, var(--codex-accent) 26%, var(--codex-border));
}
.tool-log-head {
  display: flex;
  min-height: 34px;
  width: 100%;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  text-align: left;
}
.tool-log-head:not(:disabled):hover {
  background: color-mix(in srgb, var(--codex-hover, #f0f0f0) 66%, transparent);
}
.tool-log-head:disabled {
  cursor: default;
}
.tool-log-chevron,
.tool-log-icon {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
}
.tool-log-chevron {
  transition: transform 0.14s ease, opacity 0.14s ease;
}
.tool-log-chevron.open {
  transform: rotate(90deg);
}
.tool-log-chevron.hidden {
  opacity: 0;
}
.tool-log-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--codex-text-secondary, #5f5f5f);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: 1.25;
}
.tool-log-status {
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
  color: #16a34a;
}
.status-error {
  color: #dc2626;
}
.status-rejected {
  color: #d97706;
}
.tool-recovery {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid var(--codex-border, #dcdcdc);
  background: color-mix(in srgb, #f59e0b 7%, transparent);
  padding: 7px 10px;
  color: #92400e;
  font-size: 11.5px;
  line-height: 1.45;
}
.tool-log-body {
  border-top: 1px solid var(--codex-border, #dcdcdc);
  background: color-mix(in srgb, var(--codex-bg, #fff) 70%, var(--codex-hover, #f0f0f0));
}
.tool-output {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: 8px 11px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--codex-text-secondary, #727272);
  font-family: var(--codex-code-font);
  font-size: 12px;
  line-height: 1.45;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.process-expand-enter-active,
.process-expand-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.process-expand-enter-from,
.process-expand-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

/* ── AI 回复正文：对标 Cursor 的代码块/行内代码（浅色主题浅块，暗色主题深块）── */
.code-agent-parts {
  --md-code-shell-bg: #ffffff;
  --md-code-bg: transparent;
  --md-code-fg: #1f2328;
  --md-code-border: #d8dee4;
  --md-code-radius: 12px;
  --md-code-shadow: none;
  --md-code-lang-bg: transparent;
  --md-code-lang-fg: #59636e;
  --md-code-copy-bg: transparent;
  --md-code-copy-fg: #59636e;
  --md-code-copy-hover-bg: #e2e5e9;
  --md-code-copy-hover-fg: #1f2328;
  --md-code-scrollbar-thumb: rgba(140, 149, 159, 0.4);
  --md-code-scrollbar-track: transparent;
  --md-inline-bg: #eff1f3;
  --md-inline-fg: #1f2328;
  --md-inline-border: #d8dee4;
  --ca-hl-comment: #6e7781;
  --ca-hl-keyword: #cf222e;
  --ca-hl-string: #0a3069;
  --ca-hl-title: #8250df;
  --ca-hl-number: #0550ae;
  --ca-hl-type: #953800;
  --ca-hl-meta: #116329;
}
:global([data-theme='dark']) .code-agent-parts {
  --md-code-shell-bg: #0f141b;
  --md-code-bg: #161b22;
  --md-code-fg: #e6edf3;
  --md-code-border: rgba(240, 246, 252, 0.1);
  --md-code-inner-border: rgba(240, 246, 252, 0.08);
  --md-code-lang-fg: #8b949e;
  --md-code-copy-bg: rgba(255, 255, 255, 0.06);
  --md-code-copy-fg: #c9d1d9;
  --md-code-copy-hover-bg: rgba(255, 255, 255, 0.12);
  --md-code-copy-hover-fg: #ffffff;
  --md-code-scrollbar-thumb: rgba(110, 118, 129, 0.5);
  --md-inline-bg: rgba(110, 118, 129, 0.4);
  --md-inline-fg: #e6edf3;
  --md-inline-border: transparent;
  --ca-hl-comment: #8b949e;
  --ca-hl-keyword: #ff7b72;
  --ca-hl-string: #a5d6ff;
  --ca-hl-title: #d2a8ff;
  --ca-hl-number: #79c0ff;
  --ca-hl-type: #ffa657;
  --ca-hl-meta: #79c0ff;
}

/* 更贴近 Cursor 的浅色内容卡片（不影响命令块 command-block） */
.code-agent-parts :deep(.code-block:not(.command-block)),
.code-agent-parts :deep(.code-block:not(.command-block) pre) {
  border-radius: var(--md-code-radius);
}
.code-agent-parts :deep(.code-block:not(.command-block) pre) {
  margin: 0;
  padding: 2.35rem 0.85rem 0.75rem;
}
.code-agent-parts :deep(.code-block:not(.command-block) .code-toolbar) {
  padding: 0.65rem 0.8rem 0;
}

/* hljs 语法着色：随主题切换 */
.code-agent-parts :deep(.code-block .hljs) {
  background: transparent;
  color: var(--md-code-fg);
}
.code-agent-parts :deep(.hljs-comment),
.code-agent-parts :deep(.hljs-quote) {
  color: var(--ca-hl-comment);
  font-style: italic;
}
.code-agent-parts :deep(.hljs-keyword),
.code-agent-parts :deep(.hljs-selector-tag),
.code-agent-parts :deep(.hljs-built_in),
.code-agent-parts :deep(.hljs-name),
.code-agent-parts :deep(.hljs-tag) {
  color: var(--ca-hl-keyword);
}
.code-agent-parts :deep(.hljs-string),
.code-agent-parts :deep(.hljs-attr),
.code-agent-parts :deep(.hljs-template-string),
.code-agent-parts :deep(.hljs-addition) {
  color: var(--ca-hl-string);
}
.code-agent-parts :deep(.hljs-title),
.code-agent-parts :deep(.hljs-section),
.code-agent-parts :deep(.hljs-title.function_),
.code-agent-parts :deep(.hljs-title.class_) {
  color: var(--ca-hl-title);
}
.code-agent-parts :deep(.hljs-number),
.code-agent-parts :deep(.hljs-literal),
.code-agent-parts :deep(.hljs-symbol),
.code-agent-parts :deep(.hljs-bullet),
.code-agent-parts :deep(.hljs-link) {
  color: var(--ca-hl-number);
}
.code-agent-parts :deep(.hljs-type),
.code-agent-parts :deep(.hljs-attribute),
.code-agent-parts :deep(.hljs-variable),
.code-agent-parts :deep(.hljs-template-variable),
.code-agent-parts :deep(.hljs-params) {
  color: var(--ca-hl-type);
}
.code-agent-parts :deep(.hljs-meta) {
  color: var(--ca-hl-meta);
}
.code-agent-parts :deep(.hljs-emphasis) {
  font-style: italic;
}
.code-agent-parts :deep(.hljs-strong) {
  font-weight: 600;
}

/* 行内代码中性化（去掉蓝色 accent，贴近 Cursor）——特异性高于 MarkdownContent 默认 */
.code-agent-parts :deep(.markdown-body .markdown-inner :not(.code-block) > code) {
  background: var(--md-inline-bg);
  color: var(--md-inline-fg);
  border: 1px solid var(--md-inline-border);
}
</style>
