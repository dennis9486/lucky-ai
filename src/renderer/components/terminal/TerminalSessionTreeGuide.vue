<script setup lang="ts">
export type SessionTreeRole = 'none' | 'first' | 'middle' | 'last' | 'only'

defineProps<{ role: SessionTreeRole }>()
</script>

<template>
  <span v-if="role !== 'none'" class="session-tree" aria-hidden="true">
    <svg class="session-tree-svg" viewBox="0 0 16 24" fill="none">
      <path
        v-if="role === 'middle' || role === 'last'"
        class="session-tree-line"
        d="M8 0 V12"
      />
      <path
        v-if="role === 'first' || role === 'middle'"
        class="session-tree-line"
        d="M8 12 V24"
      />
      <path class="session-tree-line" d="M8 12 H16" />
    </svg>
  </span>
</template>

<style scoped>
.session-tree {
  @apply flex h-6 w-4 shrink-0 items-center justify-center;
}
.session-tree-svg {
  @apply h-full w-full;
}
.session-tree-line {
  stroke: color-mix(in srgb, var(--codex-text) 52%, transparent);
  stroke-width: 1.25;
  vector-effect: non-scaling-stroke;
}
</style>
