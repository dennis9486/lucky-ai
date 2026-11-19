<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string
    options: Array<{ value: string; label: string }>
    variant?: 'light' | 'dark'
  }>(),
  { variant: 'light' }
)

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="segmented" :class="`variant-${variant}`">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segmented-item"
      :class="{ 'is-active': modelValue === option.value }"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  @apply inline-flex p-0.5 rounded-[10px];
}
.variant-light {
  @apply bg-codex-hover;
}
.variant-dark {
  @apply bg-codex-hover;
}
.segmented-item {
  @apply px-3.5 py-1.5 text-[12px] rounded-[8px] text-codex-text-secondary transition-all;
}
.variant-light .segmented-item.is-active {
  @apply bg-codex-bg text-codex-text shadow-sm;
}
.variant-dark .segmented-item.is-active {
  @apply bg-codex-text text-codex-bg shadow-sm;
}
</style>
