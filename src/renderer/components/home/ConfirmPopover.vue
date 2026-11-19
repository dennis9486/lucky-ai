<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat.store.js'
import { describeTool } from '../../utils/tool-display.js'

const { t } = useI18n()
const chat = useChatStore()

const tools = computed(() => {
  return chat.pendingConfirm?.toolCalls.map((toolCall) => {
    const d = describeTool({
      type: 'tool',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      output: '',
      status: 'pending'
    })
    return {
      id: toolCall.id,
      label: [d.verb, d.target].filter(Boolean).join(' ') || toolCall.name
    }
  }) ?? []
})

const title = computed(() => {
  const count = chat.pendingConfirm?.toolCalls.length ?? 0
  return t('chat.confirmTitle', { count })
})

function approve(): void {
  chat.confirmTools(true)
}

function reject(): void {
  chat.confirmTools(false)
}

defineExpose({ approve, reject })
</script>

<template>
  <div v-if="chat.showPendingConfirm" class="confirm-card" role="dialog" aria-modal="true">
    <div class="confirm-header">{{ title }}</div>

    <div class="confirm-list pretty-scrollbar">
      <div v-for="tool in tools" :key="tool.id" class="confirm-item">
        <Play :size="12" :stroke-width="2" class="confirm-icon" />
        <span class="confirm-label" :title="tool.label">{{ tool.label }}</span>
      </div>
    </div>

    <div class="confirm-actions">
      <button type="button" class="btn-reject" @click="reject">
        {{ t('chat.reject') }}
      </button>
      <button type="button" class="btn-confirm" @click="approve">
        {{ t('chat.confirm') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.confirm-card {
  @apply mb-2 overflow-hidden rounded-[16px] border border-codex-border bg-codex-bg px-3 py-2.5;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.12);
}

.confirm-header {
  @apply pb-1.5 text-[12px] font-medium text-codex-muted;
}

.confirm-list {
  @apply max-h-40 space-y-1 overflow-y-auto;
}

.confirm-item {
  @apply flex items-start gap-2 rounded-lg bg-codex-hover px-2.5 py-1.5;
}

.confirm-icon {
  @apply mt-0.5 shrink-0 text-codex-text-secondary;
}

.confirm-label {
  @apply min-w-0 flex-1 font-mono text-[12px] leading-5 text-codex-text;
  word-break: break-word;
}

.confirm-actions {
  @apply mt-2.5 flex items-center justify-end gap-2 border-t border-codex-border pt-2.5;
}

.btn-confirm {
  @apply rounded-lg bg-codex-text px-3 py-1.5 text-[12px] font-medium text-white
         transition-opacity hover:opacity-90;
}

.btn-reject {
  @apply rounded-lg px-3 py-1.5 text-[12px] text-codex-muted transition-colors
         hover:bg-codex-hover hover:text-codex-text;
}
</style>
