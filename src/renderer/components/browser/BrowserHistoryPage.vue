<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock3, ExternalLink, MoreVertical, Search, Trash2 } from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'
import type {
  BrowserHistoryClearRange,
  BrowserHistoryEntry
} from '../../../shared/types/browser.js'

const emit = defineEmits<{ open: [url: string]; openNewTab: [url: string] }>()

const { t, locale } = useI18n()
const browser = useBrowserStore()
const query = ref('')
const selectedIds = ref<Set<string>>(new Set())
const rangeMenuOpen = ref(false)
const clearRange = ref<BrowserHistoryClearRange>('lastDay')
const rowMenu = ref<{ x: number; y: number; item: BrowserHistoryEntry; items: ContextMenuItem[] } | null>(null)

const ranges: BrowserHistoryClearRange[] = ['lastHour', 'lastDay', 'lastWeek', 'lastFourWeeks', 'all']

const filteredHistory = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return browser.history
  return browser.history.filter((item) => `${item.title} ${item.url}`.toLowerCase().includes(q))
})

const groupedHistory = computed(() => {
  const groups = new Map<string, BrowserHistoryEntry[]>()
  for (const item of filteredHistory.value) {
    const key = dayLabel(item.visitedAt)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return Array.from(groups, ([label, items]) => ({ label, items }))
})

const selectedCount = computed(() => selectedIds.value.size)

function dayLabel(value: number): string {
  const date = new Date(value)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const formatted = new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(date)
  return sameDay ? `${t('browser.today')} - ${formatted}` : formatted
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(value)
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function faviconFor(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return ''
  }
}

function toggleSelected(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

async function removeSelected(): Promise<void> {
  const ids = Array.from(selectedIds.value)
  selectedIds.value = new Set()
  for (const id of ids) await browser.removeHistory(id)
}

async function clearByRange(): Promise<void> {
  await browser.clearHistoryRange(clearRange.value)
  selectedIds.value = new Set()
  rangeMenuOpen.value = false
}

function openRowMenu(item: BrowserHistoryEntry, event: MouseEvent): void {
  event.preventDefault()
  rowMenu.value = {
    x: event.clientX,
    y: event.clientY,
    item,
    items: [
      { id: 'open', label: t('browser.open') },
      { id: 'open-new-tab', label: t('browser.openInNewTab') },
      { id: 'copy-url', label: t('browser.copyUrl') },
      { id: 'sep', separator: true },
      { id: 'remove', label: t('browser.removeHistory'), danger: true }
    ]
  }
}

async function selectRowMenu(item: ContextMenuItem): Promise<void> {
  const target = rowMenu.value?.item
  rowMenu.value = null
  if (!target) return
  if (item.id === 'open') emit('open', target.url)
  if (item.id === 'open-new-tab') emit('openNewTab', target.url)
  if (item.id === 'copy-url') await navigator.clipboard.writeText(target.url)
  if (item.id === 'remove') await browser.removeHistory(target.id)
}
</script>

<template>
  <section class="internal-page">
    <aside class="internal-rail">
      <div class="rail-brand">
        <Clock3 :size="22" />
        <strong>{{ t('browser.history') }}</strong>
      </div>
      <button type="button" class="rail-item active">
        <Clock3 :size="17" />
        <span>{{ t('browser.chromeHistory') }}</span>
      </button>
      <button type="button" class="rail-item" @click="rangeMenuOpen = true">
        <Trash2 :size="17" />
        <span>{{ t('browser.deleteBrowsingData') }}</span>
      </button>
    </aside>

    <main class="internal-main pretty-scrollbar browser-scroll">
      <header class="internal-topbar">
        <label class="internal-search">
          <Search :size="17" />
          <input v-model="query" :placeholder="t('browser.historySearch')" />
        </label>
      </header>

      <div v-if="rangeMenuOpen" class="range-card">
        <div class="range-title">{{ t('browser.deleteBrowsingData') }}</div>
        <div class="range-options">
          <button
            v-for="range in ranges"
            :key="range"
            type="button"
            class="range-option"
            :class="{ active: clearRange === range }"
            @click="clearRange = range"
          >
            {{ t(`browser.historyRange.${range}`) }}
          </button>
        </div>
        <div class="range-actions">
          <button type="button" class="ghost-action" @click="rangeMenuOpen = false">{{ t('common.cancel') }}</button>
          <button type="button" class="danger-action" @click="clearByRange">{{ t('browser.deleteRange') }}</button>
        </div>
      </div>

      <div v-if="selectedCount" class="selection-bar">
        <span>{{ t('browser.selectedCount', { count: selectedCount }) }}</span>
        <button type="button" @click="removeSelected">{{ t('browser.deleteSelected') }}</button>
      </div>

      <div v-if="groupedHistory.length" class="history-card">
        <section v-for="group in groupedHistory" :key="group.label" class="history-group">
          <h3>{{ group.label }}</h3>
          <article
            v-for="item in group.items"
            :key="item.id"
            class="history-row"
            @contextmenu="openRowMenu(item, $event)"
          >
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleSelected(item.id)"
              @click.stop
            />
            <time>{{ timeLabel(item.visitedAt) }}</time>
            <img v-if="faviconFor(item.url)" :src="faviconFor(item.url)" alt="" />
            <Clock3 v-else class="fallback-icon" :size="17" />
            <button type="button" class="row-title" @click="emit('open', item.url)">
              <span>{{ item.title || item.url }}</span>
              <small>{{ hostLabel(item.url) }}</small>
            </button>
            <button type="button" class="row-icon-btn" :title="t('browser.open')" @click="emit('openNewTab', item.url)">
              <ExternalLink :size="15" />
            </button>
            <button type="button" class="row-icon-btn" @click="openRowMenu(item, $event)">
              <MoreVertical :size="16" />
            </button>
          </article>
        </section>
      </div>

      <div v-else class="internal-empty">{{ t(query ? 'browser.noLibraryResults' : 'browser.noHistory') }}</div>
    </main>

    <ContextMenu
      v-if="rowMenu"
      :x="rowMenu.x"
      :y="rowMenu.y"
      :items="rowMenu.items"
      @close="rowMenu = null"
      @select="selectRowMenu"
    />
  </section>
</template>

<style scoped>
.internal-page {
  @apply flex h-full w-full overflow-hidden bg-codex-bg text-codex-text;
}
.internal-rail {
  @apply w-[260px] shrink-0 border-r border-codex-border px-3 py-5;
  background: color-mix(in srgb, var(--codex-text) 2.5%, var(--codex-bg));
}
.rail-brand {
  @apply mb-6 flex items-center gap-3 px-2 text-[22px] font-semibold;
}
.rail-brand svg {
  @apply text-codex-accent;
}
.rail-item {
  @apply flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] font-medium text-codex-muted hover:text-codex-text;
}
.rail-item:hover,
.rail-item.active {
  background: color-mix(in srgb, var(--codex-accent) 10%, var(--codex-bg));
  color: var(--codex-accent);
}
.internal-main {
  @apply min-w-0 flex-1 overflow-y-auto px-8 py-5;
}
.internal-topbar {
  @apply sticky top-0 z-10 mb-6 flex justify-center pb-3;
  background: color-mix(in srgb, var(--codex-bg) 95%, transparent);
}
.internal-search {
  @apply flex h-11 w-full max-w-[820px] items-center gap-3 rounded-2xl border border-codex-border px-4 text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 4%, var(--codex-bg));
}
.internal-search input {
  @apply min-w-0 flex-1 bg-transparent text-[14px] text-codex-text outline-none placeholder:text-codex-muted;
}
.history-card,
.range-card,
.selection-bar {
  @apply mx-auto w-full max-w-[980px] rounded-2xl border border-codex-border bg-codex-bg shadow-sm;
}
.range-card {
  @apply mb-4 p-4;
}
.range-title {
  @apply mb-3 text-[15px] font-semibold;
}
.range-options {
  @apply grid grid-cols-5 gap-2;
}
.range-option,
.ghost-action,
.danger-action {
  @apply h-9 rounded-xl px-3 text-[13px] font-medium;
}
.range-option {
  @apply border border-codex-border text-codex-muted hover:text-codex-text;
}
.range-option.active {
  @apply border-codex-accent text-codex-accent;
  background: color-mix(in srgb, var(--codex-accent) 9%, transparent);
}
.range-actions {
  @apply mt-4 flex justify-end gap-2;
}
.ghost-action {
  @apply text-codex-muted hover:bg-codex-sidebar-hover hover:text-codex-text;
}
.danger-action {
  @apply bg-red-600 text-white hover:bg-red-700;
}
.selection-bar {
  @apply mb-4 flex h-12 items-center justify-between px-4 text-[14px] font-medium;
}
.selection-bar button {
  @apply rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50;
}
.history-group {
  @apply py-4;
}
.history-group + .history-group {
  @apply border-t border-codex-border;
}
.history-group h3 {
  @apply mb-3 px-5 text-[16px] font-semibold;
}
.history-row {
  @apply grid min-h-[42px] grid-cols-[28px_68px_26px_minmax(0,1fr)_32px_32px] items-center gap-3 px-5 text-[14px];
}
.history-row:hover {
  background: color-mix(in srgb, var(--codex-text) 4%, transparent);
}
.history-row input {
  @apply h-4 w-4 accent-[var(--codex-accent)];
}
.history-row time,
.history-row small {
  @apply text-codex-muted;
}
.history-row img {
  @apply h-5 w-5 rounded object-contain;
}
.fallback-icon {
  @apply text-codex-muted;
}
.row-title {
  @apply flex min-w-0 items-baseline gap-2 text-left;
}
.row-title span {
  @apply truncate font-medium text-codex-text;
}
.row-title small {
  @apply shrink-0 text-[13px];
}
.row-icon-btn {
  @apply grid h-8 w-8 place-items-center rounded-lg text-codex-muted hover:bg-codex-sidebar-hover hover:text-codex-text;
}
.internal-empty {
  @apply mx-auto mt-24 max-w-[520px] text-center text-[14px] text-codex-muted;
}
</style>
