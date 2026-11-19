<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, Check, ChevronRight, MoreHorizontal } from 'lucide-vue-next'
import { useCodeAgentStore, type CodeAgentTurn } from '../../stores/code-agent.store.js'

/**
 * Code Agent 会话历史弹层：今天/昨天/更早分组 + 归档区 + 搜索。
 * 右键/更多按钮的上下文菜单由父级统一渲染（与标签页共用），本组件只上抛事件。
 */
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'context-menu', event: MouseEvent, sessionId: string): void
}>()

const { t } = useI18n()
const agent = useCodeAgentStore()

const historyQuery = ref('')
const showArchived = ref(false)

const visibleHistory = computed(() =>
  filterSessions(agent.visibleSessions).slice().sort((a, b) => b.updatedAt - a.updatedAt)
)
const archivedHistory = computed(() => filterSessions(agent.archivedSessions))
const todaySessions = computed(() => visibleHistory.value.filter((session) => isToday(session.updatedAt)))
const yesterdaySessions = computed(() => visibleHistory.value.filter((session) => isYesterday(session.updatedAt)))
const olderSessions = computed(() => visibleHistory.value.filter((session) => !isToday(session.updatedAt) && !isYesterday(session.updatedAt)))

function filterSessions<T extends { title: string; lastUserText: string; turns?: CodeAgentTurn[] }>(sessions: T[]): T[] {
  const query = historyQuery.value.trim().toLowerCase()
  if (!query) return sessions
  return sessions.filter((session) => {
    const turnText = session.turns?.map((turn) => turn.userText).join(' ') ?? ''
    return `${session.title} ${session.lastUserText} ${turnText}`.toLowerCase().includes(query)
  })
}

function isToday(time: number): boolean {
  const date = new Date(time)
  const now = new Date()
  return date.toDateString() === now.toDateString()
}

function isYesterday(time: number): boolean {
  const date = new Date(time)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date.toDateString() === yesterday.toDateString()
}

function activateFromHistory(id: string): void {
  agent.restoreSession(id)
  agent.switchSession(id)
  emit('close')
}
</script>

<template>
  <div class="history-popover" @click.stop>
    <input v-model="historyQuery" class="history-search" :placeholder="t('codeAgent.searchAgents')" />

    <section v-if="todaySessions.length" class="history-section">
      <div class="history-title">{{ t('codeAgent.today') }}</div>
      <div
        v-for="session in todaySessions"
        :key="session.id"
        class="history-row"
        role="button"
        tabindex="0"
        :class="{ active: session.id === agent.activeSessionId }"
        @click="activateFromHistory(session.id)"
        @keydown.enter.prevent="activateFromHistory(session.id)"
        @keydown.space.prevent="activateFromHistory(session.id)"
        @contextmenu="emit('context-menu', $event, session.id)"
      >
        <Check :size="15" />
        <span>{{ session.title }}</span>
        <button type="button" class="history-more" @click.stop="emit('context-menu', $event, session.id)">
          <MoreHorizontal :size="15" />
        </button>
      </div>
    </section>

    <section v-if="yesterdaySessions.length" class="history-section">
      <div class="history-title">{{ t('codeAgent.yesterday') }}</div>
      <div
        v-for="session in yesterdaySessions"
        :key="session.id"
        class="history-row"
        role="button"
        tabindex="0"
        @click="activateFromHistory(session.id)"
        @keydown.enter.prevent="activateFromHistory(session.id)"
        @keydown.space.prevent="activateFromHistory(session.id)"
        @contextmenu="emit('context-menu', $event, session.id)"
      >
        <Check :size="15" />
        <span>{{ session.title }}</span>
        <button type="button" class="history-more" @click.stop="emit('context-menu', $event, session.id)">
          <MoreHorizontal :size="15" />
        </button>
      </div>
    </section>

    <section v-if="olderSessions.length" class="history-section">
      <div class="history-title">{{ t('codeAgent.older') }}</div>
      <div
        v-for="session in olderSessions"
        :key="session.id"
        class="history-row"
        role="button"
        tabindex="0"
        @click="activateFromHistory(session.id)"
        @keydown.enter.prevent="activateFromHistory(session.id)"
        @keydown.space.prevent="activateFromHistory(session.id)"
        @contextmenu="emit('context-menu', $event, session.id)"
      >
        <Check :size="15" />
        <span>{{ session.title }}</span>
        <button type="button" class="history-more" @click.stop="emit('context-menu', $event, session.id)">
          <MoreHorizontal :size="15" />
        </button>
      </div>
    </section>

    <button type="button" class="archived-toggle" @click="showArchived = !showArchived">
      <ChevronRight :size="15" :class="{ open: showArchived }" />
      <span>{{ t('codeAgent.archived') }}</span>
      <span>{{ agent.archivedSessions.length }}</span>
    </button>
    <section v-if="showArchived" class="history-section archived">
      <button
        v-for="session in archivedHistory"
        :key="session.id"
        type="button"
        class="history-row"
        @click="activateFromHistory(session.id)"
      >
        <Archive :size="15" />
        <span>{{ session.title }}</span>
      </button>
    </section>
  </div>
</template>

<style scoped>
.history-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 90;
  width: min(320px, calc(100vw - 24px));
  max-height: min(460px, calc(100vh - 88px));
  overflow: auto;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
  padding: 10px;
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.16);
}
.history-search {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 4px 2px 10px;
  color: var(--codex-text, #1a1a1a);
  font-size: 13px;
  outline: none;
}
.history-search::placeholder {
  color: var(--codex-muted, #8a8a8a);
}
.history-section {
  padding: 4px 0 8px;
}
.history-title {
  padding: 6px 2px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
}
.history-row,
.archived-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border-radius: 7px;
  padding: 6px 7px;
  color: var(--codex-text-secondary, #4a4a4a);
  text-align: left;
}
.history-row:hover,
.history-row.active {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.history-row span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-more {
  display: inline-flex;
  opacity: 0;
  color: var(--codex-muted, #8a8a8a);
}
.history-row:hover .history-more {
  opacity: 1;
}
.archived-toggle {
  border-top: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 0;
  color: var(--codex-muted, #8a8a8a);
}
.archived-toggle svg.open {
  rotate: 90deg;
}
.archived-toggle span:nth-child(2) {
  flex: 1;
}
</style>
