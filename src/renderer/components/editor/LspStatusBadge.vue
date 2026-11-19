<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '../../stores/editor.store.js'
import { resolveEditorLanguage } from '../../services/monaco.service.js'
import {
  subscribeLanguageClients,
  type LanguageClientStatus,
  type RegisteredLanguageClient
} from '../../services/lsp-client.service.js'

const props = withDefaults(defineProps<{ variant?: 'compact' | 'full' }>(), { variant: 'compact' })

const { t } = useI18n()
const editor = useEditorStore()
const clients = ref<RegisteredLanguageClient[]>([])
let unsubscribe: (() => void) | null = null

const languageId = computed(() => {
  const path = editor.activeTab?.path ?? ''
  return path ? resolveEditorLanguage(path) : ''
})

const client = computed<RegisteredLanguageClient | null>(() => {
  if (!languageId.value) return null
  return clients.value.find((item) => item.languageId === languageId.value) ?? null
})

const status = computed<LanguageClientStatus>(() => client.value?.status ?? 'idle')

// 仅在确实涉及语言服务器时展示（运行/启动/失败），无服务器或未启动的文件不显示
const visible = computed(() => status.value === 'running' || status.value === 'starting' || status.value === 'failed')

const label = computed(() => {
  switch (status.value) {
    case 'running': return t('lsp.statusRunning')
    case 'starting': return t('lsp.statusStarting')
    case 'failed': return t('lsp.statusFailed')
    default: return ''
  }
})

const tooltip = computed(() => {
  const current = client.value
  if (!current) return label.value
  const lines = [label.value]
  if (current.serverCommand) lines.push(current.serverCommand)
  if (current.error) lines.push(current.error)
  return lines.join('\n')
})

onMounted(() => {
  unsubscribe = subscribeLanguageClients((list) => { clients.value = list })
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>
  <span
    v-if="visible"
    class="lsp-badge"
    :class="[`is-${status}`, `variant-${props.variant}`]"
    :title="tooltip"
    role="status"
  >
    <span class="lsp-dot" />
    <span class="lsp-label">{{ label }}</span>
    <span v-if="props.variant === 'full' && status === 'failed' && client?.error" class="lsp-error">
      {{ client.error }}
    </span>
  </span>
</template>

<style scoped>
.lsp-badge {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--codex-muted, #8a8a8a);
  white-space: nowrap;
}
.lsp-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 999px;
  background: currentColor;
}
.lsp-badge.is-running {
  color: #16a34a;
}
.lsp-badge.is-starting {
  color: #d97706;
}
.lsp-badge.is-starting .lsp-dot {
  animation: lsp-pulse 1s ease-in-out infinite;
}
.lsp-badge.is-failed {
  color: #dc2626;
}
.lsp-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.variant-compact .lsp-label {
  color: inherit;
}
.lsp-error {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--codex-muted, #8a8a8a);
  font-weight: 400;
}
@keyframes lsp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
