<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2 } from 'lucide-vue-next'
import type { McpKeyValue } from '../../../shared/types/mcp.js'

const props = defineProps<{
  items: McpKeyValue[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel: string
}>()

const emit = defineEmits<{
  'update:items': [value: McpKeyValue[]]
}>()

const { t } = useI18n()

const resolvedKeyPlaceholder = computed(
  () => props.keyPlaceholder ?? t('settings.mcpForm.key')
)
const resolvedValuePlaceholder = computed(
  () => props.valuePlaceholder ?? t('settings.mcpForm.value')
)

function patch(index: number, field: 'key' | 'value', value: string): void {
  const next = props.items.map((item, i) =>
    i === index ? { ...item, [field]: value } : item
  )
  emit('update:items', next)
}

function remove(index: number): void {
  emit('update:items', props.items.filter((_, i) => i !== index))
}

function add(): void {
  emit('update:items', [...props.items, { key: '', value: '' }])
}
</script>

<template>
  <div class="kv-list">
    <div v-for="(item, index) in items" :key="index" class="kv-row">
      <input
        :value="item.key"
        class="kv-input"
        :placeholder="resolvedKeyPlaceholder"
        @input="patch(index, 'key', ($event.target as HTMLInputElement).value)"
      />
      <input
        :value="item.value"
        class="kv-input"
        :placeholder="resolvedValuePlaceholder"
        @input="patch(index, 'value', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="kv-remove" @click="remove(index)">
        <Trash2 :size="15" :stroke-width="1.75" />
      </button>
    </div>
    <button type="button" class="kv-add" @click="add">{{ addLabel }}</button>
  </div>
</template>

<style scoped>
.kv-list {
  @apply space-y-2;
}
.kv-row {
  @apply flex items-center gap-2;
}
.kv-input {
  @apply flex-1 min-w-0 px-3 py-2 text-[13px] rounded-lg border border-codex-border
         bg-codex-hover outline-none focus:border-codex-accent;
}
.kv-remove {
  @apply p-2 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors shrink-0;
}
.kv-add {
  @apply w-full py-2 text-[13px] rounded-lg border border-codex-border bg-codex-hover
         text-codex-text-secondary hover:bg-codex-bg transition-colors;
}
</style>
