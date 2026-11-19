<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MessageBubble from './MessageBubble.vue'
import MessageParts from './MessageParts.vue'
import ComposerSection from './ComposerSection.vue'
import ChatTaskReminder from './ChatTaskReminder.vue'
import PlanTracker from './PlanTracker.vue'
import { useChatStore } from '../../stores/chat.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useUiStore } from '../../stores/ui.store.js'

const { t } = useI18n()
const chat = useChatStore()
const sessions = useSessionStore()
const projects = useProjectStore()
const ui = useUiStore()
const messagesEl = ref<HTMLElement | null>(null)

const showPlanTracker = computed(() => ui.planMode && chat.activePlan)
const showStreamingPlaceholder = computed(() => chat.isRunning && !chat.hasStreaming)
const showStreamingBlock = computed(() => chat.hasStreaming || showStreamingPlaceholder.value)

async function handleSend(): Promise<void> {
  if (!chat.input.trim() && ui.composerAttachments.length === 0) return
  const ready = await projects.ensureWorkspace()
  if (!ready) return
  await sessions.ensureActiveSession()
  await chat.sendMessage()
}

function scrollToBottom(): void {
  const el = messagesEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

/** 等 DOM 与 Markdown 布局完成后再滚到底部 */
async function scrollToBottomWhenReady(): Promise<void> {
  await nextTick()
  scrollToBottom()
  requestAnimationFrame(scrollToBottom)
}

onMounted(() => {
  void scrollToBottomWhenReady()
})

watch(
  () => [
    sessions.activeSessionId,
    chat.messages.length,
    chat.messages[chat.messages.length - 1]?.id,
    chat.isRunning,
    chat.streamingParts
  ] as const,
  () => { void scrollToBottomWhenReady() },
  { deep: true, flush: 'post' }
)

watch(
  () => chat.showPendingConfirm,
  (visible) => {
    if (!visible) return
    void nextTick(() => {
      document.querySelector('.confirm-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
)
</script>

<template>
  <div class="chat-view">
    <div class="messages-shell">
      <div ref="messagesEl" class="messages pretty-scrollbar">
        <div class="messages-inner">
          <MessageBubble
            v-for="msg in chat.displayMessages"
            :key="msg.id"
            :role="msg.role === 'user' ? 'user' : 'assistant'"
            :content="msg.content"
            :parts="msg.parts"
            :meta="msg.meta"
            :timestamp="msg.timestamp"
            @continue="chat.input = t('chat.continuePrompt')"
          />

          <div v-if="showStreamingBlock" class="streaming-block">
            <MessageParts v-if="chat.hasStreaming" :parts="chat.streamingParts" live />
            <div v-else class="assistant-pending" role="status" aria-live="polite">
              <span class="assistant-pending-dot" aria-hidden="true" />
              <span>{{ t('chat.pendingResponse') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="composer-area">
      <div class="composer-stack">
        <ChatTaskReminder />
        <PlanTracker
          v-if="showPlanTracker"
          :plan="chat.activePlan"
          :collapsed="chat.planCollapsed"
          class="plan-panel"
          @update:collapsed="chat.planCollapsed = $event"
        />
        <ComposerSection
          :placeholder="t('composer.placeholderChat')"
          popover-placement="above"
          @send="handleSend"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  @apply flex-1 flex flex-col bg-codex-bg min-h-0;
}
.messages-shell {
  @apply flex flex-1 min-h-0;
}
.messages {
  @apply flex-1 overflow-y-auto min-h-0;
}
.messages-inner {
  @apply flex w-full max-w-[var(--content-measure)] flex-col gap-6 mx-auto px-6 py-8;
}
.streaming-block {
  @apply w-full;
}
.assistant-pending {
  @apply inline-flex items-center gap-2 text-[13px] leading-relaxed text-codex-muted;
}
.assistant-pending-dot {
  @apply h-1.5 w-1.5 rounded-full bg-current;
  opacity: 0.55;
  animation: assistant-pending-pulse 1.2s ease-in-out infinite;
}
@keyframes assistant-pending-pulse {
  0%,
  100% {
    transform: scale(0.82);
    opacity: 0.36;
  }
  50% {
    transform: scale(1);
    opacity: 0.72;
  }
}
.composer-area {
  @apply shrink-0 px-6 pb-6 flex flex-col items-center;
}
.composer-stack {
  @apply w-full max-w-[var(--content-measure)] flex flex-col gap-2.5;
}
.plan-panel {
  @apply shrink-0;
}
@media (max-width: 720px) {
  .messages-inner {
    @apply px-4 py-6;
  }
  .composer-area {
    @apply px-4 pb-4;
  }
}
</style>
