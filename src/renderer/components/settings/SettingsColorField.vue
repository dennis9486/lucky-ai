<script setup lang="ts">
import { computed } from 'vue'
import { normalizeHex, parseHex } from '../../utils/color.js'

const props = defineProps<{
  modelValue: string
  fallback?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const colorValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', normalizeHex(value, props.fallback ?? '#000000'))
})

const displayHex = computed(() => props.modelValue.toUpperCase())

const textLight = computed(() => {
  const rgb = parseHex(props.modelValue)
  if (!rgb) return false
  const [r, g, b] = rgb
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62
})
</script>

<template>
  <label class="color-pill" :class="{ 'text-dark': !textLight }">
    <input v-model="colorValue" type="color" class="color-input" />
    <span class="color-fill" :style="{ backgroundColor: modelValue }" />
    <span class="color-hex">{{ displayHex }}</span>
  </label>
</template>

<style scoped>
.color-pill {
  @apply relative flex items-center w-[148px] h-[34px] rounded-[10px] overflow-hidden
         border border-black/10 cursor-pointer shrink-0;
}
.color-input {
  @apply absolute inset-0 opacity-0 cursor-pointer z-10;
}
.color-fill {
  @apply absolute inset-0;
}
.color-hex {
  @apply relative z-[1] ml-auto px-3 text-[12px] font-mono font-medium text-white;
}
.color-pill.text-dark .color-hex {
  @apply text-codex-text;
}
</style>
