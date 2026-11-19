<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  ChevronDown,
  FolderOpen,
  GitBranchPlus,
  MoreHorizontal,
  Pin,
  SquarePen,
  X
} from 'lucide-vue-next'
import SidebarChatItem from './SidebarChatItem.vue'
import type { SidebarProjectGroup } from '../../../shared/types/session.js'

const COLLAPSED_ITEM_LIMIT = 5

const props = defineProps<{
  group: SidebarProjectGroup
  activeChatId: string | null
  pinned?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  rename: [id: string]
  delete: [id: string]
  archive: [id: string]
  unarchive: [id: string]
  exportMarkdown: [id: string]
  activate: [group: SidebarProjectGroup]
  newChat: [group: SidebarProjectGroup]
  pin: [group: SidebarProjectGroup]
  reveal: [group: SidebarProjectGroup]
  worktree: [group: SidebarProjectGroup]
  renameProject: [group: SidebarProjectGroup]
  archiveAll: [group: SidebarProjectGroup]
  removeProject: [group: SidebarProjectGroup]
}>()

const { t } = useI18n()
const groupCollapsed = ref(false)
const itemsExpanded = ref(false)
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const canExpandItems = computed(() => props.group.items.length > COLLAPSED_ITEM_LIMIT)
const visibleItems = computed(() => {
  if (itemsExpanded.value || !canExpandItems.value) return props.group.items
  return props.group.items.slice(0, COLLAPSED_ITEM_LIMIT)
})

function toggleGroupCollapsed(): void {
  groupCollapsed.value = !groupCollapsed.value
}

function toggleItemsExpanded(): void {
  itemsExpanded.value = !itemsExpanded.value
}

function toggleMenu(event: MouseEvent): void {
  event.stopPropagation()
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function onDocClick(event: MouseEvent): void {
  if (!menuRef.value?.contains(event.target as Node)) closeMenu()
}

function runMenuAction(action: () => void): void {
  action()
  closeMenu()
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="project-group" :class="{ 'is-collapsed': groupCollapsed, 'is-pinned': pinned }">
    <div class="group-header-bar" :class="{ 'is-menu-open': menuOpen }">
      <button
        type="button"
        class="group-collapse-btn"
        :title="groupCollapsed ? t('nav.expandGroup') : t('nav.collapseGroup')"
        @click="toggleGroupCollapsed"
      >
        <ChevronDown :size="14" :stroke-width="2" class="group-chevron" :class="{ collapsed: groupCollapsed }" />
      </button>

      <button type="button" class="group-title-btn" @click="emit('activate', group)">
        <FolderOpen :size="14" :stroke-width="2" class="group-folder-icon" />
        <span class="truncate">{{ group.name }}</span>
      </button>

      <div class="group-header-actions">
        <div ref="menuRef" class="group-menu-wrap">
          <button type="button" class="group-icon-btn" :title="t('nav.projectActions')" @click="toggleMenu">
            <MoreHorizontal :size="15" />
          </button>
          <div v-if="menuOpen" class="group-menu">
            <button type="button" class="menu-row" @click="runMenuAction(() => emit('pin', group))">
              <Pin :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ pinned ? t('project.menu.unpin') : t('project.menu.pin') }}</span>
            </button>
            <button
              type="button"
              class="menu-row"
              :disabled="!group.workspacePath"
              @click="runMenuAction(() => emit('reveal', group))"
            >
              <FolderOpen :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ t('project.menu.revealInFinder') }}</span>
            </button>
            <button type="button" class="menu-row" @click="runMenuAction(() => emit('worktree', group))">
              <GitBranchPlus :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ t('project.menu.createWorktree') }}</span>
            </button>
            <button type="button" class="menu-row" @click="runMenuAction(() => emit('renameProject', group))">
              <SquarePen :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ t('project.menu.rename') }}</span>
            </button>
            <button type="button" class="menu-row" @click="runMenuAction(() => emit('archiveAll', group))">
              <Archive :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ t('project.menu.archiveConversations') }}</span>
            </button>
            <div class="menu-divider" />
            <button type="button" class="menu-row danger" @click="runMenuAction(() => emit('removeProject', group))">
              <X :size="15" :stroke-width="2" class="menu-icon" />
              <span>{{ t('project.menu.remove') }}</span>
            </button>
          </div>
        </div>
        <button type="button" class="group-icon-btn" :title="t('nav.newChatInProject')" @click="emit('newChat', group)">
          <SquarePen :size="15" />
        </button>
      </div>
    </div>

    <div v-if="!groupCollapsed" class="group-items">
      <SidebarChatItem
        v-for="item in visibleItems"
        :key="item.id"
        :title="item.title"
        :shortcut="item.shortcut"
        :time-ago="item.timeAgo"
        :archived="item.archived"
        :active="activeChatId === item.id"
        @click="emit('select', item.id)"
        @rename="emit('rename', item.id)"
        @delete="emit('delete', item.id)"
        @archive="emit('archive', item.id)"
        @unarchive="emit('unarchive', item.id)"
        @export-markdown="emit('exportMarkdown', item.id)"
      />
      <button
        v-if="canExpandItems"
        type="button"
        class="expand-items-btn"
        @click="toggleItemsExpanded"
      >
        {{ itemsExpanded ? t('nav.collapse') : t('nav.expand') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.project-group {
  @apply mb-2;
}
.group-header-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.5rem;
  padding: 0.25rem 0.375rem;
  background: color-mix(in srgb, var(--codex-hover, #f0f0f0) 70%, transparent);
}
.group-collapse-btn,
.group-title-btn,
.group-icon-btn,
.expand-items-btn {
  @apply border-0 bg-transparent transition-colors;
}
.group-collapse-btn {
  @apply flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codex-text-secondary hover:text-codex-text;
}
.group-chevron {
  @apply transition-transform duration-150;
}
.group-chevron.collapsed {
  transform: rotate(-90deg);
}
.group-title-btn {
  @apply flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] font-medium text-codex-text;
  transition: padding-right 0.15s ease;
}
.group-header-bar:hover .group-title-btn,
.group-header-bar:focus-within .group-title-btn,
.group-header-bar.is-menu-open .group-title-btn {
  padding-right: 3.5rem;
}
.group-folder-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.group-header-actions {
  position: absolute;
  top: 50%;
  right: 0.375rem;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 0.15s ease;
}
.group-header-bar:hover .group-header-actions,
.group-header-bar:focus-within .group-header-actions,
.group-header-bar.is-menu-open .group-header-actions {
  opacity: 1;
  pointer-events: auto;
}
.group-icon-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-text-secondary hover:text-codex-text;
}
.group-menu-wrap {
  @apply relative;
}
.group-menu {
  @apply absolute right-0 top-full z-40 mt-1 min-w-[220px] rounded-xl border border-codex-border
         bg-codex-bg py-1.5 shadow-lg;
}
.menu-row {
  @apply flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-codex-text
         transition-colors hover:bg-codex-hover disabled:cursor-not-allowed disabled:opacity-45;
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
.group-items {
  @apply mt-1 space-y-px pl-1;
}
.expand-items-btn {
  @apply w-full px-2.5 py-1.5 text-left text-[12px] text-codex-muted transition-colors hover:text-codex-text;
}
</style>
