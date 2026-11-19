<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { Smartphone } from 'lucide-vue-next'
import UserProfileMenu from './UserProfileMenu.vue'
import { useAuthStore } from '../../stores/auth.store.js'

const { t } = useI18n()
const auth = useAuthStore()

const profileLabel = computed(() => auth.displayName ?? auth.email ?? t('sidebar.localUser'))
const profileInitial = computed(() => profileLabel.value[0]?.toUpperCase() ?? 'U')

const wrapRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)

onClickOutside(wrapRef, () => {
  menuOpen.value = false
})

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}
</script>

<template>
  <div ref="wrapRef" class="user-profile-wrap">
    <UserProfileMenu
      v-if="menuOpen"
      :email="profileLabel"
      @close="menuOpen = false"
    />

    <button type="button" class="user-profile" @click="toggleMenu">
      <div class="avatar">{{ profileInitial }}</div>
      <div class="info min-w-0">
        <div class="email truncate">{{ profileLabel }}</div>
        <div class="plan-row">
          <span class="plan-badge">{{ t('sidebar.localMode') }}</span>
        </div>
      </div>
    </button>

    <button type="button" class="device-btn" :title="t('sidebar.device')" @click.stop>
      <Smartphone :size="16" :stroke-width="2" />
    </button>
  </div>
</template>

<style scoped>
.user-profile-wrap {
  @apply relative flex items-center gap-1 px-2 py-2 border-t border-codex-border;
}
.user-profile {
  @apply flex-1 flex items-center gap-2.5 min-w-0 px-1 py-1 rounded-lg
         hover:bg-codex-sidebar-hover transition-colors text-left;
}
.avatar {
  @apply w-8 h-8 rounded-full bg-violet-500 text-white text-sm font-semibold
         flex items-center justify-center shrink-0;
}
.info {
  @apply flex-1 min-w-0;
}
.email {
  @apply text-[13px] text-codex-text;
}
.plan-badge {
  @apply text-[11px] text-codex-muted;
}
.device-btn {
  @apply p-1.5 rounded-md text-codex-text hover:bg-codex-sidebar-hover transition-colors shrink-0;
}
</style>
