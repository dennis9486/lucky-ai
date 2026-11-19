<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createLogger } from '../../../shared/utils/log.js'
import { renderMarkdown } from '../../utils/markdown.js'
import { useBrowserStore } from '../../stores/browser.store.js'
import { ipc } from '../../services/ipc-client.js'
import 'highlight.js/styles/github.min.css'

const logger = createLogger('renderer/markdown-content')

const props = withDefaults(
  defineProps<{
    source: string
    /** 流式生成中：防抖渲染 + 显示光标 */
    streaming?: boolean
    /** 思考块使用更紧凑的排版 */
    variant?: 'default' | 'thinking'
  }>(),
  {
    streaming: false,
    variant: 'default'
  }
)

const browser = useBrowserStore()
const { t } = useI18n()
const html = ref('')
const copyHint = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let copyHintTimer: ReturnType<typeof setTimeout> | null = null

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement

  const copyBtn = target.closest('.code-copy') as HTMLButtonElement | null
  if (copyBtn) {
    event.preventDefault()
    const block = copyBtn.closest('.code-block')
    const code = block?.querySelector('code')
    const text = code?.textContent ?? ''
    if (text) {
      void navigator.clipboard.writeText(text).then(() => {
        copyHint.value = t('common.copied')
        if (copyHintTimer) clearTimeout(copyHintTimer)
        copyHintTimer = setTimeout(() => { copyHint.value = '' }, 1500)
      })
    }
    return
  }

  const anchor = target.closest('a')
  if (!anchor) return

  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return

  if (/^https?:\/\//i.test(href)) {
    event.preventDefault()
    browser.openUrl(href)
    return
  }

  if (/^mailto:/i.test(href)) {
    event.preventDefault()
    void ipc.app.openExternal(href)
  }
}

function updateHtml(source: string, streaming: boolean): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  const render = () => {
    try {
      html.value = renderMarkdown(source, streaming)
    } catch (error) {
      logger.error('render markdown content failed', { streaming, error })
      html.value = ''
    }
  }

  if (streaming) {
    debounceTimer = setTimeout(render, 48)
  } else {
    render()
  }
}

watch(
  () => [props.source, props.streaming] as const,
  ([source, streaming]) => updateHtml(source, streaming),
  { immediate: true }
)

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (copyHintTimer) clearTimeout(copyHintTimer)
})

const isEmpty = computed(() => !props.source.trim())
</script>

<template>
  <div
    v-if="!isEmpty"
    class="markdown-body prose prose-sm max-w-none"
    :class="[
      variant === 'thinking' ? 'markdown-thinking' : 'markdown-chat',
      { 'is-streaming': streaming }
    ]"
  >
    <div class="markdown-inner" v-html="html" @click="handleClick" />
    <span v-if="streaming" class="stream-cursor" aria-hidden="true" />
    <span v-if="copyHint" class="copy-toast">{{ copyHint }}</span>
  </div>
</template>

<style scoped>
.markdown-body {
  @apply relative min-w-0 text-[14px] leading-[1.75] text-codex-text;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.markdown-thinking {
  @apply text-[12px] leading-[1.65] text-codex-text-secondary;
}
.markdown-inner {
  @apply min-w-0 max-w-full;
}
.markdown-body.is-streaming .markdown-inner {
  @apply inline;
}
.markdown-body.is-streaming {
  @apply inline-flex flex-wrap items-baseline gap-0;
}
.stream-cursor {
  @apply inline-block w-[2px] h-[1em] bg-codex-accent ml-0.5 shrink-0;
  animation: cursor-blink 1s steps(2, jump-none) infinite;
}
.copy-toast {
  @apply fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg
         bg-codex-text text-codex-bg text-[10px] font-medium shadow-lg pointer-events-none;
}
@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
:deep(.markdown-inner > :first-child) {
  @apply mt-0;
}
:deep(.markdown-inner > :last-child) {
  @apply mb-0;
}
:deep(.markdown-inner p) {
  @apply my-3 leading-[1.75];
}
:deep(.markdown-inner p:first-child) {
  @apply mt-0;
}
:deep(.markdown-inner h1),
:deep(.markdown-inner h2),
:deep(.markdown-inner h3),
:deep(.markdown-inner h4),
:deep(.markdown-inner h5),
:deep(.markdown-inner h6) {
  @apply mt-5 mb-2.5 font-semibold leading-snug text-codex-text;
}
:deep(.markdown-inner h1) { @apply text-[21px]; }
:deep(.markdown-inner h2) { @apply text-[18px]; }
:deep(.markdown-inner h3) { @apply text-[16px]; }
:deep(.markdown-inner h4) { @apply text-[15px]; }
:deep(.markdown-inner ul),
:deep(.markdown-inner ol) {
  @apply my-3 pl-5;
}
:deep(.markdown-inner li) {
  @apply my-1 text-codex-text;
}
:deep(.markdown-inner strong),
:deep(.markdown-inner b) {
  @apply font-semibold text-codex-text;
}
:deep(.markdown-inner em) {
  @apply text-codex-text-secondary;
}
:deep(.markdown-inner li > p) {
  @apply my-1;
}
:deep(.markdown-inner blockquote) {
  @apply my-3 rounded-lg border-l-[3px] border-codex-accent bg-codex-hover px-3 py-2
         text-[13px] leading-relaxed text-codex-text-secondary;
}
:deep(.markdown-inner blockquote p) {
  @apply my-0;
}
:deep(.markdown-inner a) {
  @apply text-codex-accent no-underline hover:text-codex-accent-hover hover:underline;
  overflow-wrap: anywhere;
}
:deep(.markdown-inner hr) {
  @apply my-5 h-px border-0;
  background: linear-gradient(90deg, transparent, var(--codex-border), transparent);
}
:deep(.markdown-inner table) {
  @apply my-4 block w-full max-w-full overflow-x-auto text-[13px] text-codex-text;
  border-collapse: collapse;
  overscroll-behavior-x: contain;
  overflow-wrap: anywhere;
  word-break: break-word;
}
:deep(.markdown-inner :not(.code-block) > code) {
  @apply rounded-md bg-codex-hover px-1.5 py-0.5 text-[0.88em] text-codex-accent;
  font-family: var(--codex-code-font);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.markdown-body :deep(.markdown-inner table thead th) {
  @apply px-4 py-2.5 text-left align-middle font-semibold text-codex-text;
  background: color-mix(in srgb, var(--codex-text) 4%, var(--codex-bg));
  border-bottom: 1px solid var(--codex-border-hover);
  white-space: nowrap;
}
.markdown-body :deep(.markdown-inner table td) {
  @apply px-4 py-2.5 text-left align-top text-codex-text;
  border-bottom: 1px solid color-mix(in srgb, var(--codex-border) 85%, transparent);
}
.markdown-body :deep(.markdown-inner table tbody tr:last-child td) {
  border-bottom: 0;
}
.markdown-body :deep(.markdown-inner table tbody tr:hover td) {
  background-color: color-mix(in srgb, var(--codex-hover) 55%, transparent);
}
.markdown-body :deep(.markdown-inner table th > code),
.markdown-body :deep(.markdown-inner table td > code) {
  @apply rounded-[6px] px-1.5 py-[2px] text-[0.86em] font-medium;
  font-family: var(--codex-code-font);
  color: var(--codex-text-secondary);
  background: color-mix(in srgb, var(--codex-text) 6%, var(--codex-bg));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
:deep(.code-block) {
  @apply relative my-4 min-w-0 max-w-full overflow-hidden;
  border-radius: var(--md-code-radius, 13px);
  background: var(--md-code-shell-bg, color-mix(in srgb, var(--codex-bg) 96%, var(--codex-hover)));
  border: 1px solid var(--md-code-border, var(--codex-border));
  box-shadow: var(--md-code-shadow, 0 1px 1px rgba(15, 23, 42, 0.025));
}
:deep(.command-block) {
  @apply my-3 flex min-h-[42px] items-center rounded-[11px] border border-codex-border bg-codex-bg shadow-none;
}
:deep(.code-toolbar) {
  @apply pointer-events-none absolute left-0 right-0 top-0 z-[1] flex items-center justify-between gap-3 px-3.5 pt-3;
}
:deep(.code-lang) {
  @apply rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide;
  background: var(--md-code-lang-bg, transparent);
  color: var(--md-code-lang-fg, var(--codex-text-secondary));
}
:deep(.code-copy) {
  @apply pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border-0
         p-0 opacity-55 transition-all;
  background: var(--md-code-copy-bg, transparent);
  color: var(--md-code-copy-fg, var(--codex-text-secondary));
}
:deep(.code-copy:hover) {
  opacity: 1;
  background: var(--md-code-copy-hover-bg, color-mix(in srgb, var(--codex-text) 11%, transparent));
  color: var(--md-code-copy-hover-fg, var(--codex-text));
}
:deep(.code-block:hover .code-copy) {
  @apply opacity-100;
}
:deep(.command-block .code-copy) {
  @apply absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg border border-codex-border
         text-codex-muted opacity-100 shadow-[0_1px_4px_rgba(0,0,0,0.08)]
         hover:bg-codex-hover hover:text-codex-text;
  background-color: color-mix(in srgb, var(--codex-bg) 95%, transparent);
}
:deep(.code-copy-icon) {
  @apply block h-4 w-4;
}
:deep(.code-block pre) {
  @apply max-w-full overflow-x-auto overflow-y-hidden text-[12px] leading-[1.7];
  margin: 0;
  padding: 40px 14px 13px;
  border-radius: var(--md-code-radius, 13px);
  background: var(--md-code-bg, transparent);
  color: var(--md-code-fg, var(--codex-text));
  border: 0;
  font-family: var(--codex-code-font);
  white-space: pre;
  overscroll-behavior-x: contain;
  scrollbar-color: var(--md-code-scrollbar-thumb, rgba(120, 120, 120, 0.36)) var(--md-code-scrollbar-track, transparent);
  scrollbar-width: thin;
}
:deep(.code-block code) {
  @apply bg-transparent p-0 text-[12px] text-inherit;
  font-family: var(--codex-code-font);
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}
:deep(.code-block code.language-text),
:deep(.code-block code.language-plaintext),
:deep(.code-block code.language-text *),
:deep(.code-block code.language-plaintext *) {
  color: var(--md-code-fg, var(--codex-text)) !important;
}
:deep(.command-block pre) {
  @apply m-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-[11px] bg-transparent py-2 pl-3.5 pr-12 text-[13px] leading-6;
  color: var(--codex-text, #1f1f1f);
  scrollbar-width: thin;
}
:deep(.command-block code) {
  @apply text-[13px] leading-6;
  padding: 0;
  background: transparent !important;
}
:deep(.command-block .hljs) {
  background: transparent !important;
  color: var(--codex-text, #1f1f1f);
}
:deep(.command-block .hljs-built_in),
:deep(.command-block .hljs-name),
:deep(.command-block .hljs-keyword) {
  color: var(--codex-accent, #2f8cff);
}
:deep(.command-block .hljs-string),
:deep(.command-block .hljs-attr),
:deep(.command-block .hljs-variable) {
  color: #8d72d9;
}
:deep(.command-block .hljs-literal),
:deep(.command-block .hljs-number) {
  color: #c83aa0;
}
:deep(.code-block pre::-webkit-scrollbar) {
  @apply h-2.5;
}
:deep(.code-block pre::-webkit-scrollbar-track) {
  margin: 0 14px;
  border-radius: 999px;
  background: var(--md-code-scrollbar-track, transparent);
}
:deep(.code-block pre::-webkit-scrollbar-thumb) {
  border: 2px solid var(--md-code-shell-bg, color-mix(in srgb, var(--codex-bg) 96%, var(--codex-hover)));
  border-radius: 999px;
  background: var(--md-code-scrollbar-thumb, rgba(120, 120, 120, 0.36));
}
:deep(.code-block pre::-webkit-scrollbar-thumb:hover) {
  background: var(--md-code-scrollbar-thumb-hover, rgba(92, 92, 92, 0.48));
}
@media (hover: none) {
  :deep(.code-copy) {
    @apply opacity-80;
  }
}
</style>
