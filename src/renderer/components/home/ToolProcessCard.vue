<script setup lang="ts">
import type { ToolCallPart } from '../../../shared/types/ai.js'
import ToolCallCard from './ToolCallCard.vue'

defineProps<{
  parts: ToolCallPart[]
}>()
</script>

<template>
  <div class="tool-process-list">
    <ToolCallCard
      v-for="tool in parts"
      :key="tool.id"
      :part="tool"
      compact
    />
  </div>
</template>

<style scoped>
.tool-process-list {
  @apply my-1.5 ml-1 flex w-full flex-col gap-1.5 border-l border-codex-border pl-3;
}
</style>
