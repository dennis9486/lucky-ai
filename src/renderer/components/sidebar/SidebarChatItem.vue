<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, FileDown, MoreHorizontal, Pencil, Trash2, Undo2 } from 'lucide-vue-next'

defineProps<{
  title: string
  shortcut?: string
  timeAgo?: string
  active?: boolean
  archived?: boolean
}>()

const emit = defineEmits<{
  click: []
  rename: []
  delete: []
  archive: []
  unarchive: []
  exportMarkdown: []
}>()

const { t } = useI18n()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function toggleMenu(e: MouseEvent): void {
  e.stopPropagation()
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function onDocClick(e: MouseEvent): void {
  if (!menuRef.value?.contains(e.target as Node)) closeMenu()
}

function runMenuAction(action: () => void): void {
  action()
  closeMenu()
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="chat-item-wrap" :class="{ 'is-active': active }">
    <button type="button" class="sidebar-chat-item" @click="emit('click')">
      <span class="truncate flex-1 text-left">{{ title }}</span>
      <span v-if="archived" class="archived-badge">{{ t('session.archive') }}</span>
      <span v-if="shortcut" class="shortcut">{{ shortcut }}</span>
      <span v-else-if="timeAgo" class="time-ago">{{ timeAgo }}</span>
    </button>
    <div ref="menuRef" class="item-menu">
      <button type="button" class="menu-trigger" @click="toggleMenu">
        <MoreHorizontal :size="14" />
      </button>
      <div v-if="menuOpen" class="menu-popover">
        <button type="button" class="menu-row" @click="runMenuAction(() => emit('rename'))">
          <Pencil :size="15" :stroke-width="2" class="menu-icon" />
          <span>{{ t('session.rename') }}</span>
        </button>
        <button type="button" class="menu-row" @click="runMenuAction(() => emit('exportMarkdown'))">
          <FileDown :size="15" :stroke-width="2" class="menu-icon" />
          <span>{{ t('session.export.markdown') }}</span>
        </button>
        <button
          v-if="!archived"
          type="button"
          class="menu-row"
          @click="runMenuAction(() => emit('archive'))"
        >
          <Archive :size="15" :stroke-width="2" class="menu-icon" />
          <span>{{ t('session.archive') }}</span>
        </button>
        <button
          v-else
          type="button"
          class="menu-row"
          @click="runMenuAction(() => emit('unarchive'))"
        >
          <Undo2 :size="15" :stroke-width="2" class="menu-icon" />
          <span>{{ t('session.unarchive') }}</span>
        </button>
        <div class="menu-divider" />
        <button type="button" class="menu-row danger" @click="runMenuAction(() => emit('delete'))">
          <Trash2 :size="15" :stroke-width="2" class="menu-icon" />
          <span>{{ t('session.delete') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-item-wrap {
  @apply relative flex items-center rounded-md transition-colors hover:bg-codex-sidebar-hover;
}
.chat-item-wrap.is-active {
  @apply bg-codex-sidebar-hover;
}
.sidebar-chat-item {
  @apply flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-[13px] text-codex-text;
}
.chat-item-wrap.is-active .sidebar-chat-item {
  @apply font-medium;
}
.archived-badge {
  @apply shrink-0 text-[10px] uppercase tracking-wide text-codex-muted;
}
.shortcut {
  @apply shrink-0 text-[11px] tabular-nums text-codex-muted;
}
.time-ago {
  @apply shrink-0 text-[11px] tabular-nums text-codex-muted;
}
.item-menu {
  @apply relative shrink-0 pr-1 opacity-0 transition-opacity;
}
.chat-item-wrap:hover .item-menu,
.chat-item-wrap.is-active .item-menu,
.chat-item-wrap:focus-within .item-menu {
  @apply opacity-100;
}
.menu-trigger {
  @apply flex h-6 w-6 items-center justify-center rounded-md text-codex-text-secondary
         hover:bg-codex-hover hover:text-codex-text;
}
.menu-popover {
  @apply absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-xl border border-codex-border
         bg-codex-bg py-1.5 shadow-lg;
}
.menu-row {
  @apply flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-codex-text
         transition-colors hover:bg-codex-hover;
}
.menu-row.danger {
  @apply text-red-500;
}
.menu-row.danger:hover {
  background: color-mix(in srgb, #fef2f2 100%, transparent);
}
:global([data-theme='dark']) .menu-row.danger:hover {
  background: color-mix(in srgb, #450a0a 30%, transparent);
}
.menu-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.menu-divider {
  @apply my-1.5 mx-3 border-t border-codex-border;
}
</style>
