<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, FolderOpen, Link2, MoreVertical, Search, X } from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'
import type { BrowserDownload } from '../../../shared/types/browser.js'

const { t, locale } = useI18n()
const browser = useBrowserStore()
const query = ref('')
const rowMenu = ref<{ x: number; y: number; item: BrowserDownload; items: ContextMenuItem[] } | null>(null)

const filteredDownloads = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return browser.downloads
  return browser.downloads.filter((item) =>
    `${item.filename} ${item.url} ${item.savePath} ${item.status}`.toLowerCase().includes(q)
  )
})

const groupedDownloads = computed(() => {
  const groups = new Map<string, BrowserDownload[]>()
  for (const item of filteredDownloads.value) {
    const key = dayLabel(item.startedAt)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return Array.from(groups, ([label, items]) => ({ label, items }))
})

function dayLabel(value: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(value)
}

function hostLabel(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function meta(item: BrowserDownload): string {
  const size = item.totalBytes ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}` : formatBytes(item.receivedBytes)
  return `${hostLabel(item.url)} · ${size} · ${t(`browser.downloadStatus.${item.status}`)}`
}

function openMenu(item: BrowserDownload, event: MouseEvent): void {
  event.preventDefault()
  rowMenu.value = {
    x: event.clientX,
    y: event.clientY,
    item,
    items: [
      { id: 'open', label: t('browser.open'), disabled: item.status !== 'completed' },
      { id: 'reveal', label: t('browser.showInFolder'), disabled: !item.savePath },
      { id: 'copy-url', label: t('browser.copyUrl') },
      { id: 'sep', separator: true },
      { id: 'remove', label: t('browser.removeDownload'), danger: true }
    ]
  }
}

async function copyDownloadUrl(url: string): Promise<void> {
  await navigator.clipboard.writeText(url)
}

async function selectMenuItem(item: ContextMenuItem): Promise<void> {
  const target = rowMenu.value?.item
  rowMenu.value = null
  if (!target) return
  if (item.id === 'open') await browser.openDownload(target.savePath)
  if (item.id === 'reveal') await browser.revealDownload(target.savePath)
  if (item.id === 'copy-url') await copyDownloadUrl(target.url)
  if (item.id === 'remove') await browser.removeDownload(target.id)
}
</script>

<template>
  <section class="downloads-page">
    <header class="downloads-header">
      <div class="downloads-title">
        <Download :size="24" />
        <h2>{{ t('browser.downloads') }}</h2>
      </div>
      <label class="downloads-search">
        <Search :size="17" />
        <input v-model="query" :placeholder="t('browser.downloadsSearch')" />
      </label>
      <button v-if="browser.downloads.length" type="button" class="clear-btn" @click="browser.clearDownloads()">
        {{ t('browser.clearDownloads') }}
      </button>
    </header>

    <main class="downloads-main pretty-scrollbar browser-scroll">
      <section v-for="group in groupedDownloads" :key="group.label" class="download-group">
        <h3>{{ group.label }}</h3>
        <article
          v-for="item in group.items"
          :key="item.id"
          class="download-card"
          :class="{ muted: item.status !== 'completed' }"
          @contextmenu="openMenu(item, $event)"
        >
          <div class="file-icon">
            <Download :size="20" />
          </div>
          <button
            type="button"
            class="download-main"
            :disabled="item.status !== 'completed'"
            @click="browser.openDownload(item.savePath)"
          >
            <span>{{ item.filename }}</span>
            <small>{{ meta(item) }}</small>
          </button>
          <button type="button" class="row-icon-btn" :title="t('browser.copyUrl')" @click="copyDownloadUrl(item.url)">
            <Link2 :size="17" />
          </button>
          <button type="button" class="row-icon-btn" :title="t('browser.showInFolder')" :disabled="!item.savePath" @click="browser.revealDownload(item.savePath)">
            <FolderOpen :size="17" />
          </button>
          <button type="button" class="row-icon-btn" :title="t('browser.removeDownload')" @click="browser.removeDownload(item.id)">
            <X :size="18" />
          </button>
          <button type="button" class="row-icon-btn" @click="openMenu(item, $event)">
            <MoreVertical :size="17" />
          </button>
        </article>
      </section>

      <div v-if="!groupedDownloads.length" class="downloads-empty">
        {{ t(query ? 'browser.noLibraryResults' : 'browser.noDownloads') }}
      </div>
    </main>

    <ContextMenu
      v-if="rowMenu"
      :x="rowMenu.x"
      :y="rowMenu.y"
      :items="rowMenu.items"
      @close="rowMenu = null"
      @select="selectMenuItem"
    />
  </section>
</template>

<style scoped>
.downloads-page {
  @apply flex h-full w-full flex-col overflow-hidden bg-codex-bg text-codex-text;
}
.downloads-header {
  @apply grid h-[86px] shrink-0 grid-cols-[260px_minmax(320px,820px)_1fr] items-center gap-5 border-b border-codex-border px-8;
}
.downloads-title {
  @apply flex items-center gap-3 text-[24px] font-semibold;
}
.downloads-title svg {
  @apply text-codex-accent;
}
.downloads-title h2 {
  @apply text-[24px] font-semibold;
}
.downloads-search {
  @apply flex h-11 items-center gap-3 rounded-2xl border border-codex-border px-4 text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 4%, var(--codex-bg));
}
.downloads-search input {
  @apply min-w-0 flex-1 bg-transparent text-[14px] text-codex-text outline-none placeholder:text-codex-muted;
}
.clear-btn {
  @apply justify-self-end rounded-full border border-codex-accent px-4 py-2 text-[13px] font-semibold text-codex-accent hover:bg-codex-accent hover:text-white;
}
.downloads-main {
  @apply min-h-0 flex-1 overflow-y-auto px-8 py-6;
}
.download-group {
  @apply mx-auto mb-7 w-full max-w-[860px];
}
.download-group h3 {
  @apply mb-3 text-[16px] font-semibold;
}
.download-card {
  @apply mb-3 grid min-h-[92px] grid-cols-[52px_minmax(0,1fr)_36px_36px_36px_36px] items-center gap-4 rounded-2xl border border-codex-border bg-codex-bg px-5 shadow-sm;
}
.download-card.muted {
  @apply opacity-65;
}
.file-icon {
  @apply grid h-10 w-10 place-items-center rounded-xl border border-codex-border text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 4%, transparent);
}
.download-main {
  @apply min-w-0 text-left disabled:cursor-default;
}
.download-main span {
  @apply block truncate text-[14px] font-semibold text-codex-accent;
}
.download-main small {
  @apply mt-1 block truncate text-[12px] text-codex-muted;
}
.row-icon-btn {
  @apply grid h-9 w-9 place-items-center rounded-lg text-codex-muted hover:bg-codex-sidebar-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-45;
}
.downloads-empty {
  @apply mt-24 text-center text-[14px] text-codex-muted;
}
</style>
