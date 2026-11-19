<script setup lang="ts">
defineProps<{
  modelValue: boolean
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    class="settings-toggle"
    :class="{ 'is-on': modelValue, 'is-disabled': disabled }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="settings-toggle-knob" />
  </button>
</template>

<style scoped>
.settings-toggle {
  @apply relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full
         bg-codex-border transition-colors duration-200 cursor-pointer;
}
.settings-toggle.is-on {
  @apply bg-codex-accent;
}
.settings-toggle.is-disabled {
  @apply opacity-50 cursor-not-allowed;
}
.settings-toggle-knob {
  @apply absolute left-[2px] h-[18px] w-[18px] rounded-full bg-codex-bg shadow-sm
         transition-transform duration-200;
}
.settings-toggle.is-on .settings-toggle-knob {
  transform: translateX(16px);
}
</style>
