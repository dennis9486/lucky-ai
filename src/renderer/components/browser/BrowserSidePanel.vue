<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark, ExternalLink, Search, Trash2, X } from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'

const emit = defineEmits<{ open: [url: string] }>()

const { t } = useI18n()
const browser = useBrowserStore()
const query = ref('')

const filteredBookmarks = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return browser.bookmarks
  return browser.bookmarks.filter((item) => `${item.title} ${item.url}`.toLowerCase().includes(q))
})

function faviconFor(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return ''
  }
}

function openBookmark(url: string): void {
  emit('open', url)
}
</script>

<template>
  <aside v-if="browser.activePanel === 'bookmarks'" class="bookmark-drawer pretty-scrollbar browser-scroll">
    <header class="drawer-head">
      <div class="drawer-title">
        <Bookmark :size="17" />
        <span>{{ t('browser.bookmarks') }}</span>
      </div>
      <button type="button" class="drawer-icon" :title="t('common.close')" @click="browser.closePanel()">
        <X :size="17" />
      </button>
    </header>

    <label class="drawer-search">
      <Search :size="15" />
      <input v-model="query" :placeholder="t('browser.librarySearch')" />
    </label>

    <div v-if="filteredBookmarks.length" class="bookmark-list">
      <article v-for="item in filteredBookmarks" :key="item.id" class="bookmark-row">
        <img v-if="faviconFor(item.url)" :src="faviconFor(item.url)" alt="" />
        <Bookmark v-else class="bookmark-fallback" :size="17" />
        <button type="button" class="bookmark-main" @click="openBookmark(item.url)">
          <span>{{ item.title }}</span>
          <small>{{ item.url }}</small>
        </button>
        <button type="button" class="drawer-icon" :title="t('browser.open')" @click="openBookmark(item.url)">
          <ExternalLink :size="15" />
        </button>
        <button type="button" class="drawer-icon" :title="t('browser.removeBookmark')" @click="browser.toggleBookmark(item.url, item.title)">
          <Trash2 :size="15" />
        </button>
      </article>
    </div>

    <p v-else class="drawer-empty">{{ t(query ? 'browser.noLibraryResults' : 'browser.noBookmarks') }}</p>
  </aside>
</template>

<style scoped>
.bookmark-drawer {
  @apply w-[340px] shrink-0 overflow-y-auto border-l border-codex-border bg-codex-bg;
}
.drawer-head {
  @apply flex h-12 items-center justify-between border-b border-codex-border px-4;
}
.drawer-title {
  @apply flex items-center gap-2 text-[14px] font-semibold text-codex-text;
}
.drawer-title svg {
  @apply text-codex-accent;
}
.drawer-icon {
  @apply grid h-8 w-8 place-items-center rounded-lg text-codex-muted hover:bg-codex-sidebar-hover hover:text-codex-text;
}
.drawer-search {
  @apply mx-4 mt-4 flex h-9 items-center gap-2 rounded-xl border border-codex-border px-3 text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 3.5%, var(--codex-bg));
}
.drawer-search input {
  @apply min-w-0 flex-1 bg-transparent text-[13px] text-codex-text outline-none placeholder:text-codex-muted;
}
.bookmark-list {
  @apply mt-3;
}
.bookmark-row {
  @apply grid min-h-[58px] grid-cols-[24px_minmax(0,1fr)_32px_32px] items-center gap-2 px-4 py-2;
}
.bookmark-row:hover {
  background: color-mix(in srgb, var(--codex-text) 4%, transparent);
}
.bookmark-row img {
  @apply h-5 w-5 rounded object-contain;
}
.bookmark-fallback {
  @apply text-codex-muted;
}
.bookmark-main {
  @apply min-w-0 text-left;
}
.bookmark-main span {
  @apply block truncate text-[13px] font-medium text-codex-text;
}
.bookmark-main small {
  @apply mt-0.5 block truncate text-[11px] text-codex-muted;
}
.drawer-empty {
  @apply px-4 py-8 text-center text-[13px] text-codex-muted;
}
</style>
