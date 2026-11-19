<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  CircleUserRound,
  Settings,
  User,
  LogOut,
  UserCircle
} from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useUiStore } from '../../stores/ui.store.js'

const { t } = useI18n()

withDefaults(
  defineProps<{
    email?: string
  }>(),
  { email: '' }
)

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const ui = useUiStore()

function close(): void {
  emit('close')
}

function openSettings(): void {
  close()
  settings.showSettings = true
}

function openProfile(): void {
  openSettings()
}

function openLogout(): void {
  close()
  ui.showLogoutConfirm = true
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="profile-menu">
    <div class="menu-section">
      <div class="menu-row is-static">
        <CircleUserRound :size="15" :stroke-width="2" class="menu-icon" />
        <span class="menu-label truncate">{{ email || t('sidebar.localUser') }}</span>
      </div>
      <button type="button" class="menu-row" @click="close">
        <UserCircle :size="15" :stroke-width="2" class="menu-icon" />
        <span class="menu-label">{{ t('sidebar.account') }}</span>
      </button>
    </div>

    <div class="menu-divider" />

    <div class="menu-section">
      <button type="button" class="menu-row" @click="openProfile">
        <User :size="15" :stroke-width="2" class="menu-icon" />
        <span class="menu-label">{{ t('sidebar.profile') }}</span>
      </button>
      <button type="button" class="menu-row" @click="openSettings">
        <Settings :size="15" :stroke-width="2" class="menu-icon" />
        <span class="menu-label">{{ t('sidebar.settings') }}</span>
        <span class="menu-shortcut">⌘,</span>
      </button>
    </div>

    <div class="menu-divider" />

    <div class="menu-section">
      <button type="button" class="menu-row" @click="openLogout">
        <LogOut :size="15" :stroke-width="2" class="menu-icon" />
        <span class="menu-label">{{ t('sidebar.logout') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.profile-menu {
  @apply absolute left-2 right-2 bottom-full mb-2 bg-codex-bg rounded-xl border border-codex-border
         shadow-lg py-1.5 z-50;
}
.menu-section {
  @apply px-1.5;
}
.menu-row {
  @apply w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left
         text-[13px] text-codex-text hover:bg-codex-hover transition-colors;
}
.menu-row.is-static {
  @apply cursor-default text-codex-text-secondary hover:bg-transparent;
}
.menu-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.menu-label {
  @apply flex-1 min-w-0;
}
.menu-shortcut {
  @apply text-[12px] shrink-0 text-codex-muted;
}
.menu-divider {
  @apply my-1.5 mx-3 border-t border-codex-border;
}
</style>
