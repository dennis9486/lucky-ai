<script setup lang="ts">
import type { Component } from 'vue'
import { MessageSquare, Mail, Folder } from 'lucide-vue-next'

const iconMap: Record<string, Component> = {
  'message-square': MessageSquare,
  mail: Mail,
  folder: Folder
}

const brandStyles: Record<string, { bg: string; color: string }> = {
  'message-square': { bg: '#f4f0ff', color: '#611f69' },
  mail: { bg: '#fef2f2', color: '#ea4335' },
  folder: { bg: '#f0fdf4', color: '#34a853' }
}

defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <button type="button" class="integration-card">
    <div class="icon-wrap" :style="{ background: brandStyles[icon]?.bg }">
      <component :is="iconMap[icon]" :size="23" :style="{ color: brandStyles[icon]?.color }" />
    </div>
    <div class="content">
      <div class="title">{{ title }}</div>
      <div class="description">{{ description }}</div>
    </div>
  </button>
</template>

<style scoped>
.integration-card {
  @apply flex min-h-[138px] flex-col gap-4 rounded-[14px] border border-codex-border bg-codex-bg p-5
         text-left transition-all hover:border-codex-border-hover hover:shadow-[0_12px_34px_rgba(0,0,0,0.08)];
}
.icon-wrap {
  @apply flex h-10 w-10 items-center justify-center rounded-[10px];
}
.title {
  @apply text-[17px] font-semibold text-codex-text;
}
.description {
  @apply mt-1.5 text-[14px] font-medium leading-relaxed text-codex-muted;
}
</style>
