<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'
import { useAuthStore } from '../../stores/auth.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useChatStore } from '../../stores/chat.store.js'

const { t } = useI18n()
const ui = useUiStore()
const auth = useAuthStore()
const sessions = useSessionStore()
const projects = useProjectStore()
const chat = useChatStore()

function close(): void {
  ui.showLogoutConfirm = false
}

function confirmLogout(): void {
  ui.showLogoutConfirm = false
  chat.abortIfRunning()
  sessions.resetOnLogout()
  projects.resetOnLogout()
  auth.logout()
  ui.currentView = 'home'
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.showLogoutConfirm) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.showLogoutConfirm"
      class="logout-overlay"
      @click.self="close"
    >
      <div class="logout-dialog" role="dialog" aria-labelledby="logout-title">
        <button type="button" class="close-btn" :title="t('logout.close')" @click="close">
          <X :size="18" :stroke-width="1.75" />
        </button>

        <h2 id="logout-title" class="dialog-title">{{ t('logout.title') }}</h2>
        <p class="dialog-desc">{{ t('logout.description') }}</p>

        <div class="dialog-actions">
          <button type="button" class="btn-cancel" @click="close">{{ t('common.cancel') }}</button>
          <button type="button" class="btn-logout" @click="confirmLogout">{{ t('logout.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.logout-overlay {
  @apply fixed inset-0 z-[60] flex items-center justify-center bg-black/25 px-4;
}
.logout-dialog {
  @apply relative w-full max-w-[400px] bg-codex-bg rounded-[24px] shadow-xl px-7 pt-7 pb-6
         border border-codex-border;
}
.close-btn {
  @apply absolute top-5 right-5 p-1 rounded-md text-codex-muted
         hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.dialog-title {
  @apply text-[17px] font-semibold text-codex-text pr-8;
}
.dialog-desc {
  @apply mt-2 text-[14px] text-codex-muted leading-relaxed;
}
.dialog-actions {
  @apply mt-8 flex items-center justify-end gap-4;
}
.btn-cancel {
  @apply text-[14px] text-codex-muted hover:text-codex-text transition-colors px-1 py-1.5;
}
.btn-logout {
  @apply text-[14px] font-medium text-red-500 bg-red-50 hover:bg-red-100
         px-4 py-2 rounded-xl transition-colors;
}
</style>
