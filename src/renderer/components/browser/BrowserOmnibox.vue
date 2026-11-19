<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark, Clock3, Lock, Search, ShieldAlert } from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { BROWSER_SEARCH_URLS } from '../../../shared/types/browser.js'

const SEARCH_FALLBACK = BROWSER_SEARCH_URLS.duckduckgo
const MAX_SUGGESTIONS = 8

interface Suggestion {
  kind: 'search' | 'bookmark' | 'history' | 'url'
  label: string
  sublabel?: string
  url: string
}

const props = defineProps<{
  modelValue: string
  security: 'secure' | 'insecure' | 'none'
  zoomPercent: number
  showZoom: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  navigate: [url: string]
  'reset-zoom': []
}>()

const { t } = useI18n()
const browser = useBrowserStore()
const settings = useSettingsStore()

const inputRef = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const highlighted = ref(0)
const failedFavicons = ref<Set<string>>(new Set())

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

function normalizeAddress(raw: string): string {
  const input = raw.trim()
  if (!input) return ''
  if (/^https?:\/\//i.test(input)) return input
  if (/^lucky:\/\/(history|downloads|settings)$/i.test(input)) return input.toLowerCase()
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return ''
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(input)) return `https://${input}`
  const prefix = BROWSER_SEARCH_URLS[settings.general.browserSearchEngine] ?? SEARCH_FALLBACK
  return `${prefix}${encodeURIComponent(input)}`
}

function looksLikeUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw) || /^[\w.-]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(raw.trim())
}

const suggestions = computed<Suggestion[]>(() => {
  const raw = value.value.trim()
  const q = raw.toLowerCase()
  if (!q) return []
  const list: Suggestion[] = []
  // 顶部动作：像 URL 就“打开”，否则“搜索”
  if (looksLikeUrl(raw)) {
    list.push({ kind: 'url', label: raw, url: normalizeAddress(raw) })
  } else {
    list.push({ kind: 'search', label: t('browser.searchFor', { query: raw }), url: normalizeAddress(raw) })
  }
  const seen = new Set<string>()
  const pool: Array<Suggestion> = [
    ...browser.bookmarks.map((b) => ({ kind: 'bookmark' as const, label: b.title || b.url, sublabel: b.url, url: b.url })),
    ...browser.history.map((h) => ({ kind: 'history' as const, label: h.title || h.url, sublabel: h.url, url: h.url }))
  ]
  for (const item of pool) {
    if (list.length >= MAX_SUGGESTIONS) break
    if (seen.has(item.url)) continue
    if (item.url.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)) {
      seen.add(item.url)
      list.push(item)
    }
  }
  return list
})

const open = computed(() => focused.value && suggestions.value.length > 0)

function clampHighlight(): void {
  if (highlighted.value >= suggestions.value.length) highlighted.value = 0
}

function onInput(): void {
  highlighted.value = 0
}

function onFocus(): void {
  focused.value = true
}

function onBlur(): void {
  // 延迟关闭，保证点击建议项的 mousedown 先生效
  window.setTimeout(() => { focused.value = false }, 120)
}

function move(delta: number): void {
  const count = suggestions.value.length
  if (!count) return
  highlighted.value = (highlighted.value + delta + count) % count
}

function pick(index: number): void {
  const item = suggestions.value[index]
  const target = item ? item.url : normalizeAddress(value.value)
  if (!target) return
  focused.value = false
  inputRef.value?.blur()
  emit('navigate', target)
}

function submit(): void {
  clampHighlight()
  pick(open.value ? highlighted.value : -1)
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
  else if (event.key === 'Escape') { event.preventDefault(); focused.value = false }
}

function iconFor(kind: Suggestion['kind']): typeof Search {
  if (kind === 'search') return Search
  if (kind === 'bookmark') return Bookmark
  if (kind === 'history') return Clock3
  return Search
}

function faviconFor(url: string): string {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return `${parsed.origin}/favicon.ico`
  } catch {
    return ''
  }
}

function shouldShowFavicon(item: Suggestion): boolean {
  if (item.kind === 'search') return false
  const favicon = faviconFor(item.url)
  return Boolean(favicon) && !failedFavicons.value.has(favicon)
}

function markFaviconFailed(url: string): void {
  const favicon = faviconFor(url)
  if (!favicon) return
  failedFavicons.value = new Set([...failedFavicons.value, favicon])
}

function focus(): void {
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

defineExpose({ focus })
</script>

<template>
  <form class="omnibox" role="combobox" :aria-expanded="open" @submit.prevent="submit">
    <span v-if="security === 'secure'" class="security-badge secure" :title="t('browser.secure')">
      <Lock :size="12" />
    </span>
    <span v-else-if="security === 'insecure'" class="security-badge insecure" :title="t('browser.insecure')">
      <ShieldAlert :size="13" />
    </span>
    <input
      ref="inputRef"
      v-model="value"
      class="address-input"
      :class="{ 'has-badge': security !== 'none' }"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :placeholder="t('browser.addressPlaceholder')"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <button
      v-if="showZoom"
      type="button"
      class="zoom-pill"
      :title="t('browser.resetZoom')"
      @mousedown.prevent
      @click="emit('reset-zoom')"
    >
      {{ zoomPercent }}%
    </button>

    <ul v-if="open" class="suggest-list" role="listbox">
      <li
        v-for="(item, index) in suggestions"
        :key="`${item.kind}-${item.url}-${index}`"
        class="suggest-item"
        :class="{ active: index === highlighted }"
        role="option"
        :aria-selected="index === highlighted"
        @mousedown.prevent="pick(index)"
        @mouseenter="highlighted = index"
      >
        <span class="suggest-icon-wrap" aria-hidden="true">
          <img
            v-if="shouldShowFavicon(item)"
            :src="faviconFor(item.url)"
            alt=""
            class="suggest-favicon"
            @error="markFaviconFailed(item.url)"
          />
          <component v-else :is="iconFor(item.kind)" :size="17" class="suggest-icon" />
        </span>
        <span class="suggest-label">{{ item.label }}</span>
        <span v-if="item.sublabel" class="suggest-sub">{{ item.sublabel }}</span>
      </li>
    </ul>
  </form>
</template>

<style scoped>
.omnibox {
  @apply relative mx-2 flex min-w-[280px] flex-1 items-center;
}
.security-badge {
  @apply pointer-events-none absolute left-3 z-10 flex items-center;
}
.security-badge.secure {
  @apply text-emerald-600;
}
.security-badge.insecure {
  @apply text-amber-600;
}
.address-input {
  @apply h-[34px] w-full rounded-xl border px-4 text-[13px] font-medium text-codex-text
         outline-none transition-[border-color,box-shadow,background-color]
         focus:border-codex-border-hover;
  border-color: color-mix(in srgb, var(--codex-text) 18%, var(--codex-border));
  background-color: color-mix(in srgb, var(--codex-text) 6.5%, var(--codex-bg));
  box-shadow:
    inset 0 1px 2px color-mix(in srgb, var(--codex-text) 8%, transparent),
    0 1px 0 color-mix(in srgb, var(--codex-bg) 55%, transparent);
}
.address-input::placeholder {
  color: color-mix(in srgb, var(--codex-text) 44%, var(--codex-muted));
}
.address-input.has-badge {
  @apply pl-8;
}
.address-input:focus {
  background-color: var(--codex-bg);
  box-shadow:
    inset 0 1px 2px color-mix(in srgb, var(--codex-text) 6%, transparent),
    0 0 0 3px color-mix(in srgb, var(--codex-accent) 18%, transparent);
}
.zoom-pill {
  @apply absolute right-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text) 58%, var(--codex-muted));
}
.zoom-pill:hover {
  background: color-mix(in srgb, var(--codex-text) 10%, var(--codex-bg));
}
.suggest-list {
  @apply absolute left-0 right-0 top-[40px] z-[62] max-h-[360px] overflow-y-auto rounded-xl border
         p-1.5 shadow-2xl;
  border-color: color-mix(in srgb, var(--codex-text) 16%, var(--codex-border));
  background: color-mix(in srgb, var(--codex-text) 3%, var(--codex-bg));
}
.suggest-item {
  @apply flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-codex-text;
}
.suggest-item.active {
  background: color-mix(in srgb, var(--codex-text) 10%, var(--codex-bg));
}
.suggest-icon-wrap {
  @apply grid h-6 w-6 shrink-0 place-items-center;
}
.suggest-favicon {
  @apply h-[18px] w-[18px] rounded-[4px] object-contain;
}
.suggest-icon {
  @apply shrink-0;
  color: color-mix(in srgb, var(--codex-text) 54%, var(--codex-muted));
}
.suggest-label {
  @apply shrink-0 max-w-[45%] truncate font-medium;
}
.suggest-sub {
  @apply min-w-0 flex-1 truncate text-[12px] text-codex-muted;
}
</style>
