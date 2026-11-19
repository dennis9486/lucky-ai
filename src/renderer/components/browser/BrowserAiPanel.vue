<script setup lang="ts">
/**
 * 浏览器 AI 面板复用 Chat 页问答链路。
 *
 * 面板只负责注入当前网页上下文；消息渲染、工具卡片、确认、停止和持久化
 * 走 Chat store 的同一套能力。输入区保持浏览器面板的轻量形态。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, MessageSquarePlus, Sparkles, Square, X } from 'lucide-vue-next'
import { useBrowserStore } from '../../stores/browser.store.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { ipc } from '../../services/ipc-client.js'
import { isImeComposingEnter } from '../../utils/keyboard.js'
import ConfirmPopover from '../home/ConfirmPopover.vue'
import MessageBubble from '../home/MessageBubble.vue'
import MessageParts from '../home/MessageParts.vue'

const { t } = useI18n()
const browser = useBrowserStore()
const chat = useChatStore()
const sessions = useSessionStore()
const settings = useSettingsStore()
const listRef = ref<HTMLElement | null>(null)

const activeChatSessionTitle = computed(() => sessions.activeSession?.title ?? t('session.newChat'))
const isEmpty = computed(() => !chat.displayMessages.length && !chat.hasStreaming)

function pageContextBlock(): string {
  const url = browser.activeTabUrl
  const title = browser.activeTabTitle || ''
  const pageLine = url
    ? `当前页面: ${title || '(无标题)'}\nURL: ${url}`
    : '当前没有已打开的网页。若用户要求浏览、搜索或打开网页，请先使用 OpenInAppBrowser 打开目标页面。'

  return [
    '[浏览器模式]',
    pageLine,
    '',
    '你正在帮助用户操作内嵌浏览器。优先使用浏览器能力，而不是只凭对话上下文回答。',
    '可用浏览器工具与使用规则:',
    '- ReadBrowserPage: 读取当前网页的实时 DOM 文本。长页面按 offset 分段读取，避免一次读取过大。',
    '- ScrollBrowserToText: 当你引用网页原文或关键结论时，用精确短句定位到页面位置，让用户能看到来源。',
    '- OpenInAppBrowser: 需要打开新 URL、搜索结果或外部页面时使用；打开后再读取页面。',
    '- SnapshotBrowserPage: 需要点击、填写或识别页面交互元素时，先快照。',
    '- ClickBrowserElement / FillBrowserInput: 只使用最新 SnapshotBrowserPage 的 element_id；每次点击或填写后必须再次 Snapshot 观察结果。',
    '- ControlBrowser: 需要后退、前进或刷新时使用。',
    '',
    '浏览器操作纪律:',
    '- 操作要像用户可见的正常浏览流程：一次只做一个动作，动作后先观察页面变化，再决定下一步。',
    '- 不要批量抓取、密集翻页、并发打开大量页面，避免给站点造成压力。',
    '- 不要绕过反爬、风控、登录墙、验证码或访问限制；遇到验证码/人机校验/访问受限时说明情况并等待用户处理。',
    '- 优先使用站点公开页面、官方 API、导出入口或用户已授权的内容来源。',
    '',
    '回答纪律:',
    '- 用户问“这页/这里/当前页面”时，先 ReadBrowserPage 再回答。',
    '- 总结页面时给出结构化要点，必要时说明页面标题和 URL。',
    '- 对比多个标签页或继续浏览时，明确你打开/读取了哪些页面。',
    '- 不要臆造页面中没有的信息；读不到、页面为空或需要登录时直接说明。',
    '- 不要填写密码、支付信息、验证码或敏感凭据；需要用户自己完成。',
    '- 高风险操作（提交、删除、支付、确认）前先说明意图，并等待工具确认。',
    '',
    '用户请求:',
    ''
  ].join('\n')
}

async function scrollToBottomWhenReady(): Promise<void> {
  await nextTick()
  const el = listRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

async function createAiChatSession(): Promise<void> {
  if (chat.isRunning) chat.stopAgent()
  const session = await sessions.createSessionWithTitle(t('browser.aiPanelTitle'))
  chat.clearInput()
  void ipc.agent.resetConversation(session.id)
  void scrollToBottomWhenReady()
}

async function handleSend(): Promise<void> {
  const text = chat.input.trim()
  if (!text || chat.isRunning) return
  await chat.sendMessage({
    promptPrefix: pageContextBlock(),
    referenceContextOnly: true,
    referenceMessage: text,
    includeComposerAttachments: false,
    runtimeSource: 'browser',
    runtimeTitle: activeChatSessionTitle.value,
    runtimePriority: 65,
    runtimeMetadata: {
      browserUrl: browser.activeTabUrl,
      browserTitle: browser.activeTabTitle
    }
  })
}

async function consumePendingBrowserAiPrompt(): Promise<void> {
  const pending = browser.consumePendingAiPrompt()
  if (!pending) return
  chat.input = pending.prompt
  await nextTick()
  if (pending.autoSend) await handleSend()
}

function handlePrimaryAction(): void {
  if (chat.isRunning) {
    chat.stopAgent()
    return
  }
  void handleSend()
}

function onKeydown(event: KeyboardEvent): void {
  if (isImeComposingEnter(event)) return

  if (chat.showPendingConfirm) {
    if (event.key === 'Escape') {
      event.preventDefault()
      chat.confirmTools(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      chat.confirmTools(true)
      return
    }
  }

  const modEnter = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
  const plainEnter = event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey

  if (settings.general.sendShortcut === 'enter' && plainEnter) {
    event.preventDefault()
    void handleSend()
    return
  }

  if (settings.general.sendShortcut === 'mod-enter' && modEnter) {
    event.preventDefault()
    void handleSend()
  }
}

onMounted(() => {
  void sessions.load()
  void scrollToBottomWhenReady()
  void consumePendingBrowserAiPrompt()
})

watch(
  () => [browser.activePanel, browser.pendingAiPrompt] as const,
  (panel) => {
    if (panel[0] === 'ai') {
      void sessions.load()
      void consumePendingBrowserAiPrompt()
      void scrollToBottomWhenReady()
    }
  },
  { flush: 'post' }
)

watch(
  () => [
    sessions.activeSessionId,
    chat.displayMessages.length,
    chat.displayMessages[chat.displayMessages.length - 1]?.id,
    chat.streamingParts
  ] as const,
  () => { void scrollToBottomWhenReady() },
  { deep: true, flush: 'post' }
)
</script>

<template>
  <aside v-if="browser.activePanel === 'ai'" class="ai-drawer">
    <header class="drawer-head">
      <div class="drawer-title">
        <span :title="activeChatSessionTitle">{{ activeChatSessionTitle }}</span>
      </div>
      <div class="drawer-actions">
        <button
          type="button"
          class="drawer-icon"
          :title="t('browser.aiNewSession')"
          :aria-label="t('browser.aiNewSession')"
          @click="createAiChatSession"
        >
          <MessageSquarePlus :size="16" />
        </button>
        <button type="button" class="drawer-icon" :title="t('common.close')" :aria-label="t('common.close')" @click="browser.closePanel()">
          <X :size="17" />
        </button>
      </div>
    </header>

    <div ref="listRef" class="ai-messages pretty-scrollbar browser-scroll">
      <div class="ai-messages-inner">
        <div v-if="isEmpty" class="ai-empty">
          <Sparkles :size="22" />
          <p>{{ t('browser.aiEmptyHint') }}</p>
        </div>

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

        <div v-if="chat.hasStreaming" class="streaming-block">
          <MessageParts :parts="chat.streamingParts" live />
        </div>
      </div>
    </div>

    <div class="ai-composer-area">
      <ConfirmPopover />
      <footer class="ai-composer composer-surface">
        <textarea
          v-model="chat.input"
          class="composer-input ai-input pretty-scrollbar"
          rows="2"
          :placeholder="t('browser.aiPlaceholder')"
          @keydown="onKeydown"
        />
        <button
          type="button"
          class="ai-send composer-send-btn"
          :class="{ 'is-ready': chat.isRunning || Boolean(chat.input.trim()) }"
          :disabled="!chat.isRunning && !chat.input.trim()"
          :title="chat.isRunning ? t('composer.stop') : t('composer.send')"
          :aria-label="chat.isRunning ? t('composer.stop') : t('composer.send')"
          @click="handlePrimaryAction"
        >
          <Square v-if="chat.isRunning" :size="13" stroke-width="0" fill="currentColor" />
          <ArrowUp v-else :size="18" stroke-width="2.5" />
        </button>
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.ai-drawer {
  @apply flex w-[400px] shrink-0 flex-col border-l border-codex-border bg-codex-bg;
}
.drawer-head {
  @apply flex h-14 shrink-0 items-center justify-between border-b border-codex-border px-4;
}
.drawer-title {
  @apply min-w-0 flex-1 truncate text-[15px] font-semibold text-codex-text;
}
.drawer-actions {
  @apply flex items-center gap-1;
}
.drawer-icon {
  @apply flex h-8 w-8 items-center justify-center rounded-lg text-codex-text-secondary transition-colors
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-40;
}
.ai-messages {
  @apply min-h-0 flex-1 overflow-y-auto;
}
.ai-messages-inner {
  @apply flex min-h-full flex-col gap-5 px-5 py-5;
}
.ai-empty {
  @apply mx-auto mt-8 flex max-w-[300px] flex-col items-center gap-3 rounded-2xl border border-codex-border
         bg-codex-hover px-5 py-5 text-center text-[13px] leading-relaxed text-codex-text-secondary;
}
.ai-empty svg {
  @apply text-codex-accent;
}
.streaming-block {
  @apply w-full;
}
.ai-composer-area {
  @apply shrink-0 px-4 pb-4;
}
.ai-composer {
  @apply flex items-end gap-2 rounded-[28px] px-4 py-3;
}
.ai-input {
  @apply min-h-[78px] max-h-[150px] flex-1 resize-none border-none bg-transparent px-1 py-1
         text-[14px] leading-relaxed text-codex-text outline-none placeholder:text-codex-muted;
}
.ai-send {
  @apply h-10 w-10 shrink-0;
}
</style>
