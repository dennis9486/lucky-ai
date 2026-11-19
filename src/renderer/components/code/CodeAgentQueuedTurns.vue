<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, Check, ChevronRight, Pencil, Trash2, X } from 'lucide-vue-next'
import { useCodeAgentStore } from '../../stores/code-agent.store.js'

/** 排队中的后续消息卡片：折叠列表 + 行内编辑/排序/移除，直接操作 Code Agent store。 */
const { t } = useI18n()
const agent = useCodeAgentStore()

const collapsed = ref(false)
const editingQueuedId = ref<string | null>(null)
const queuedEditText = ref('')

function beginEditQueued(id: string, text: string): void {
  editingQueuedId.value = id
  queuedEditText.value = text
}

function saveQueuedEdit(): void {
  if (!editingQueuedId.value) return
  agent.updateQueuedTurn(editingQueuedId.value, queuedEditText.value)
  editingQueuedId.value = null
  queuedEditText.value = ''
}

function cancelQueuedEdit(): void {
  editingQueuedId.value = null
  queuedEditText.value = ''
}
</script>

<template>
  <div v-if="agent.queuedTurns.length" class="queued-card" :class="{ collapsed }">
    <div class="queued-head">
      <button type="button" class="queued-toggle" @click="collapsed = !collapsed">
        <ChevronRight :size="15" class="queued-chev" :class="{ open: !collapsed }" />
        <span>{{ t('codeAgent.queuedCount', { count: agent.queuedTurns.length }) }}</span>
      </button>
      <span v-if="agent.isRunning" class="queued-running">{{ t('codeAgent.runningNow') }}</span>
    </div>

    <div v-if="!collapsed" class="queued-list">
      <div v-for="(queued, index) in agent.queuedTurns" :key="queued.id" class="queued-row">
        <span class="queued-dot" aria-hidden="true" />
        <form
          v-if="editingQueuedId === queued.id"
          class="queued-edit"
          @submit.prevent="saveQueuedEdit"
          @keydown.esc.prevent="cancelQueuedEdit"
        >
          <input v-model="queuedEditText" class="queued-edit-input" autofocus />
          <button type="submit" class="queued-icon-btn" :title="t('common.save')">
            <Check :size="14" />
          </button>
          <button type="button" class="queued-icon-btn" :title="t('common.cancel')" @click="cancelQueuedEdit">
            <X :size="14" />
          </button>
        </form>
        <template v-else>
          <button type="button" class="queued-text" @click="beginEditQueued(queued.id, queued.text)">
            {{ queued.text }}
          </button>
          <span v-if="queued.attachments?.length" class="queued-meta">
            {{ t('codeAgent.queuedAttachments', { count: queued.attachments.length }) }}
          </span>
          <div class="queued-actions">
            <button
              type="button"
              class="queued-icon-btn"
              :title="t('codeAgent.editQueued')"
              @click="beginEditQueued(queued.id, queued.text)"
            >
              <Pencil :size="14" />
            </button>
            <button
              type="button"
              class="queued-icon-btn"
              :title="t('codeAgent.moveQueuedUp')"
              :disabled="index === 0"
              @click="agent.moveQueuedTurnUp(queued.id)"
            >
              <ArrowUp :size="14" />
            </button>
            <button
              type="button"
              class="queued-icon-btn"
              :title="t('codeAgent.removeQueued')"
              @click="agent.removeQueuedTurn(queued.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queued-card {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
}
.queued-head {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
}
.queued-toggle {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 12.5px;
  font-weight: 600;
}
.queued-chev {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
  transition: transform 0.14s ease;
}
.queued-chev.open {
  transform: rotate(90deg);
}
.queued-running {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
  font-weight: 500;
}
.queued-list {
  border-top: 1px solid var(--codex-border, #e5e5e5);
}
.queued-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 5px 9px;
}
.queued-row + .queued-row {
  border-top: 1px solid color-mix(in srgb, var(--codex-border, #e5e5e5) 72%, transparent);
}
.queued-dot {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border: 1.5px solid color-mix(in srgb, var(--codex-muted, #8a8a8a) 72%, transparent);
  border-radius: 999px;
}
.queued-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--codex-text, #1a1a1a);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 520;
}
.queued-meta {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11.5px;
}
.queued-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.queued-row:hover .queued-actions {
  opacity: 1;
}
.queued-icon-btn {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--codex-muted, #8a8a8a);
}
.queued-icon-btn:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.queued-icon-btn:disabled {
  cursor: default;
  opacity: 0.32;
}
.queued-edit {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
}
.queued-edit-input {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--codex-border-hover, #d4d4d4);
  border-radius: 7px;
  background: var(--codex-bg, #fafafa);
  padding: 4px 7px;
  color: var(--codex-text, #1a1a1a);
  font-size: 12.5px;
  outline: none;
}
.queued-edit-input:focus {
  border-color: color-mix(in srgb, var(--codex-accent, #2563eb) 56%, var(--codex-border-hover, #d4d4d4));
}
</style>
