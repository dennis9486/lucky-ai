<script setup lang="ts">
defineProps<{
  keys: string[]
}>()
</script>

<template>
  <span class="shortcut-keys">
    <kbd v-for="(key, index) in keys" :key="`${key}-${index}`" class="shortcut-key">{{ key }}</kbd>
  </span>
</template>

<style scoped>
.shortcut-keys {
  @apply inline-flex items-center gap-1;
}
.shortcut-key {
  @apply inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5
         rounded-md border border-codex-border bg-codex-hover text-[12px] font-medium
         text-codex-text shadow-[0_1px_0_rgba(0,0,0,0.04)];
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
</style>
