<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  label: string
  active?: boolean
  badge?: number
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="sidebar-nav-item"
    :class="{ 'is-active': active }"
    @click="$emit('click')"
  >
    <component :is="icon" :size="16" :stroke-width="2" class="nav-icon" />
    <span class="truncate">{{ label }}</span>
    <span v-if="badge && badge > 0" class="nav-badge">{{ badge > 99 ? '99+' : badge }}</span>
  </button>
</template>

<style scoped>
.sidebar-nav-item {
  @apply w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px]
         hover:bg-codex-sidebar-hover transition-colors text-left text-codex-text;
}
.sidebar-nav-item.is-active {
  @apply bg-codex-sidebar-hover font-medium;
}
.nav-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.sidebar-nav-item.is-active .nav-icon {
  @apply text-codex-text;
}
.nav-badge {
  @apply ml-auto shrink-0 min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center
         rounded-full text-[11px] font-semibold leading-none text-white;
  background: #d97706;
}
</style>
