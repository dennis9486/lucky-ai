<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  result: { active: number; total: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: []
  next: []
  prev: []
  close: []
}>()

const { t } = useI18n()
const inputRef = ref<HTMLInputElement | null>(null)

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
  emit('search')
}

function focus(): void {
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

defineExpose({ focus })
</script>

<template>
  <div class="find-bar" @keydown.enter.prevent="$event.shiftKey ? emit('prev') : emit('next')">
    <input
      ref="inputRef"
      class="find-input"
      type="text"
      :value="props.modelValue"
      :placeholder="t('browser.findPlaceholder')"
      @input="onInput"
    />
    <span class="find-count">{{ result.total ? `${result.active}/${result.total}` : '0/0' }}</span>
    <button type="button" class="find-btn" :disabled="!result.total" :title="t('browser.findPrev')" @click="emit('prev')">
      <ChevronUp :size="15" />
    </button>
    <button type="button" class="find-btn" :disabled="!result.total" :title="t('browser.findNext')" @click="emit('next')">
      <ChevronDown :size="15" />
    </button>
    <button type="button" class="find-btn" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')">
      <X :size="15" />
    </button>
  </div>
</template>

<style scoped>
.find-bar {
  @apply absolute right-4 top-3 z-10 flex items-center gap-1 rounded-xl border border-codex-border bg-codex-bg px-2 py-1.5 shadow-lg;
}
.find-input {
  @apply h-7 w-[180px] rounded-md border-none bg-transparent px-2 text-[13px] text-codex-text outline-none placeholder:text-codex-muted;
}
.find-count {
  @apply min-w-[42px] text-center text-[12px] font-medium text-codex-muted;
}
.find-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-muted hover:bg-codex-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-35;
}
</style>
