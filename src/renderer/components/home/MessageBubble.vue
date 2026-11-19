<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Pencil, RotateCcw } from 'lucide-vue-next'
import type { ChatMessageMeta, MessagePart } from '../../../shared/types/ai.js'
import { formatMessageTimestamp } from '../../utils/time.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { filePathToSrc } from '../../utils/attachment-preview.js'
import MarkdownContent from '../common/MarkdownContent.vue'
import MessageParts from './MessageParts.vue'
import ChatChangedFiles from './ChatChangedFiles.vue'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  parts?: MessagePart[]
  meta?: ChatMessageMeta
}>()

const emit = defineEmits<{ continue: [] }>()

const { t } = useI18n()
const chat = useChatStore()
const ui = useUiStore()
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const isUser = computed(() => props.role === 'user')
const messageImages = computed(() => props.meta?.images ?? [])
const hasParts = computed(() => !isUser.value && Array.isArray(props.parts) && props.parts.length > 0)
const showMarkdownFallback = computed(() => !isUser.value && !hasParts.value && props.content.trim())
const isIncomplete = computed(() => Boolean(props.meta?.incomplete))
const runSummary = computed(() => props.meta?.runSummary)
const showRunSummary = computed(() =>
  !isUser.value
  && Boolean(runSummary.value)
  && (
    (runSummary.value?.toolCount ?? 0) > 0
    || (runSummary.value?.changedFiles.length ?? 0) > 0
    || (runSummary.value?.verificationCommands.length ?? 0) > 0
    || (runSummary.value?.failureReasons.length ?? 0) > 0
  )
)
const copyText = computed(() => {
  const content = props.content.trim()
  if (content) return content
  const fromParts = props.parts
    ?.filter((part) => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
  return fromParts?.trim() ?? ''
})
const canCopy = computed(() => Boolean(copyText.value))

function imageSrc(path: string, previewUrl?: string): string {
  return previewUrl || filePathToSrc(path)
}

function openImage(path: string): void {
  ui.openImageAttachment(path, messageImages.value.map((image) => ({ ...image, kind: 'image' })))
}

async function copyContent(): Promise<void> {
  if (!copyText.value) return
  await navigator.clipboard.writeText(copyText.value)
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, 1200)
}

function editContent(): void {
  chat.input = props.content
  document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus()
}

function continueResponse(): void {
  emit('continue')
}
</script>

<template>
  <div class="message-block" :class="{ 'is-user': isUser, 'is-assistant': !isUser }">
    <div v-if="isIncomplete" class="incomplete-banner">
      <span>{{ t('chat.incompleteLabel') }}</span>
      <button type="button" class="continue-btn" @click="continueResponse">
        <RotateCcw :size="12" />
        {{ t('common.continue') }}
      </button>
    </div>

    <div v-if="isUser" class="user-message-stack">
      <div v-if="messageImages.length" class="user-images">
        <img
          v-for="img in messageImages"
          :key="img.path"
          class="user-image"
          :src="imageSrc(img.path, img.previewUrl)"
          :alt="img.name"
          :title="img.name"
          @click="openImage(img.path)"
        />
      </div>
      <div v-if="content" class="bubble user-bubble">{{ content }}</div>
    </div>
    <MessageParts v-else-if="hasParts" :parts="parts!" />
    <MarkdownContent v-else-if="showMarkdownFallback" :source="content" />
    <ChatChangedFiles
      v-if="showRunSummary"
      :parts="parts"
      :summary="runSummary"
    />

    <div class="message-meta">
      <span class="timestamp">{{ formatMessageTimestamp(timestamp) }}</span>
      <div class="meta-actions">
        <button
          type="button"
          class="meta-btn"
          :class="{ copied }"
          :disabled="!canCopy"
          :title="copied ? t('common.copied') : t('message.copy')"
          @click="copyContent"
        >
          <Copy :size="13" />
        </button>
        <button v-if="isUser" type="button" class="meta-btn" :title="t('message.edit')" @click="editContent">
          <Pencil :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-block {
  @apply flex w-full flex-col gap-2;
  user-select: text;
}
.message-block.is-assistant {
  @apply items-start max-w-full;
}
.incomplete-banner {
  @apply flex w-full items-center justify-between gap-3 rounded-[14px] border border-amber-200 bg-amber-50
         px-3.5 py-2.5 text-[12px] font-medium text-amber-900;
}
:global([data-theme='dark']) .incomplete-banner {
  @apply border-amber-900/40 bg-amber-950/30 text-amber-200;
}
.continue-btn {
  @apply inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-semibold
         text-amber-900 hover:bg-amber-100 transition-colors;
}
:global([data-theme='dark']) .continue-btn {
  @apply text-amber-100 hover:bg-amber-900/40;
}
.bubble {
  @apply text-[15px] font-normal leading-[1.5];
}
.user-bubble {
  @apply inline-block max-w-[78%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-codex-text;
  background-color: color-mix(in srgb, var(--codex-text) 5.5%, var(--codex-bg));
  border: 1px solid color-mix(in srgb, var(--codex-text) 4%, transparent);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.user-message-stack {
  @apply flex w-full flex-col items-end gap-3;
}
.user-images {
  @apply flex max-w-[78%] flex-wrap justify-end gap-2;
  user-select: none;
}
.user-image {
  @apply block h-[128px] w-[128px] cursor-pointer rounded-[16px] object-cover shadow-sm transition-transform hover:-translate-y-0.5;
  border: 1px solid color-mix(in srgb, var(--codex-text) 12%, transparent);
  background: color-mix(in srgb, var(--codex-text) 4%, var(--codex-bg));
}
.message-block.is-user {
  @apply items-end;
}
.message-meta {
  @apply flex items-center gap-2 px-0.5 mt-0.5 opacity-0 transition-opacity duration-150;
}
.message-block:hover .message-meta {
  @apply opacity-100;
}
.message-block.is-assistant .timestamp {
  order: 1;
}
.message-block.is-assistant .meta-actions {
  order: 0;
}
.timestamp {
  @apply text-[11px] text-codex-muted;
}
.meta-actions {
  @apply flex items-center gap-0.5;
}
.meta-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors;
  user-select: none;
}
.meta-btn:disabled {
  @apply cursor-not-allowed opacity-40 hover:bg-transparent hover:text-codex-muted;
}
.meta-btn.copied {
  @apply text-codex-accent;
}
@media (max-width: 720px) {
  .user-bubble,
  .user-images {
    @apply max-w-[88%];
  }
}
</style>
