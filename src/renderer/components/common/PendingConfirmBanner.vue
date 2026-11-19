<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat.store.js'
import { useCodeAgentStore } from '../../stores/code-agent.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { describeTool } from '../../utils/tool-display.js'

const { t } = useI18n()
const chat = useChatStore()
const agent = useCodeAgentStore()
const sessions = useSessionStore()
const ui = useUiStore()

type PendingSource = 'chat' | 'code-agent'

const pending = computed(() => {
  if (chat.pendingConfirm) {
    return {
      source: 'chat' as PendingSource,
      sessionId: chat.pendingConfirm.chatSessionId,
      toolCalls: chat.pendingConfirm.toolCalls,
      onActiveView: sessions.activeSessionId === chat.pendingConfirm.chatSessionId
        && (ui.currentView === 'chat' || ui.currentView === 'home')
    }
  }
  if (agent.pendingConfirm) {
    return {
      source: 'code-agent' as PendingSource,
      sessionId: agent.pendingConfirm.codeSessionId,
      toolCalls: agent.pendingConfirm.toolCalls,
      onActiveView: agent.activeSessionId === agent.pendingConfirm.codeSessionId
        && ui.currentView === 'code'
    }
  }
  return null
})

const visible = computed(() => pending.value !== null && !pending.value.onActiveView)

const tools = computed(() =>
  pending.value?.toolCalls.map((toolCall) => {
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
)

const title = computed(() => {
  const count = pending.value?.toolCalls.length ?? 0
  return pending.value?.source === 'code-agent'
    ? t('codeAgent.confirmTitle', { count })
    : t('chat.confirmTitle', { count })
})

function approve(): void {
  if (pending.value?.source === 'chat') chat.confirmTools(true)
  else agent.confirmTools(true)
}

function reject(): void {
  if (pending.value?.source === 'chat') chat.confirmTools(false)
  else agent.confirmTools(false)
}

function openSession(): void {
  if (!pending.value) return
  if (pending.value.source === 'chat') {
    void sessions.selectSession(pending.value.sessionId).then((session) => {
      ui.currentView = session && session.messages.length > 0 ? 'chat' : 'home'
    })
    return
  }
  agent.switchSession(pending.value.sessionId)
  ui.currentView = 'code'
}
</script>

<template>
  <div v-if="visible" class="pending-confirm-banner" role="dialog" aria-modal="true">
    <div class="banner-main">
      <div class="banner-title">{{ title }}</div>
      <div class="banner-tools">
        <div v-for="tool in tools" :key="tool.id" class="banner-tool">
          <Play :size="12" :stroke-width="2" />
          <span>{{ tool.label }}</span>
        </div>
      </div>
    </div>
    <div class="banner-actions">
      <button type="button" class="ghost-btn" @click="openSession">
        {{ t('pendingConfirm.goToSession') }}
      </button>
      <button type="button" class="ghost-btn" @click="reject">
        {{ pending?.source === 'code-agent' ? t('codeAgent.reject') : t('chat.reject') }}
      </button>
      <button type="button" class="primary-btn" @click="approve">
        {{ pending?.source === 'code-agent' ? t('codeAgent.approve') : t('chat.confirm') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pending-confirm-banner {
  @apply fixed bottom-4 left-1/2 z-[120] flex w-[min(720px,calc(100vw-32px))] -translate-x-1/2
         items-start justify-between gap-4 rounded-2xl border border-codex-border bg-codex-bg
         px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.18)];
}
.banner-title {
  @apply text-[13px] font-semibold text-codex-text;
}
.banner-tools {
  @apply mt-2 space-y-1;
}
.banner-tool {
  @apply flex items-center gap-2 text-[12px] text-codex-text-secondary font-mono truncate;
}
.banner-actions {
  @apply flex shrink-0 items-center gap-2;
}
.ghost-btn {
  @apply rounded-lg px-3 py-1.5 text-[12px] text-codex-muted transition-colors
         hover:bg-codex-hover hover:text-codex-text;
}
.primary-btn {
  @apply rounded-lg bg-codex-text px-3 py-1.5 text-[12px] font-medium text-white
         transition-opacity hover:opacity-90;
}
</style>
