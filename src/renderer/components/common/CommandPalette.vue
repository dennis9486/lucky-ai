<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../../stores/ui.store.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useChatStore } from '../../stores/chat.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { Search, X } from 'lucide-vue-next'

const { t } = useI18n()
const ui = useUiStore()
const editor = useEditorStore()
const sessions = useSessionStore()
const chat = useChatStore()
const query = ref('')
const fileResults = ref<Array<{ path: string; name: string }>>([])
const sessionResults = ref<Array<{ id: string; title: string }>>([])
const selected = ref(0)

const mode = ref<'files' | 'sessions'>(ui.commandPaletteMode)

watch(() => ui.showCommandPalette, (show) => {
  if (show) {
    query.value = ''
    fileResults.value = []
    sessionResults.value = []
    selected.value = 0
    mode.value = ui.commandPaletteMode
  }
})

watch([query, mode], async ([q, activeMode]) => {
  selected.value = 0
  if (!q.trim()) {
    fileResults.value = []
    sessionResults.value = []
    return
  }
  if (activeMode === 'files') {
    fileResults.value = await unwrap(ipc.workspace.searchFiles(q))
    sessionResults.value = []
  } else {
    const list = await sessions.searchSessions(q)
    sessionResults.value = list.map((s) => ({ id: s.id, title: s.title }))
    fileResults.value = []
  }
})

const activeResults = () => (mode.value === 'files' ? fileResults.value : sessionResults.value)

async function openSelected(): Promise<void> {
  if (mode.value === 'files') {
    const item = fileResults.value[selected.value]
    if (item) {
      void editor.openFile(item.path)
      ui.currentView = 'code'
      ui.showCommandPalette = false
    }
    return
  }
  const item = sessionResults.value[selected.value]
  if (!item) return
  chat.abortIfRunning()
  const session = await sessions.selectSessionWithProject(item.id)
  if (session) {
    ui.currentView = session.messages.length > 0 ? 'chat' : 'home'
  }
  ui.showCommandPalette = false
}

function handleKeydown(e: KeyboardEvent): void {
  const len = activeResults().length
  if (e.key === 'ArrowDown') { e.preventDefault(); selected.value = Math.min(selected.value + 1, len - 1) }
  if (e.key === 'ArrowUp') { e.preventDefault(); selected.value = Math.max(selected.value - 1, 0) }
  if (e.key === 'Enter') { e.preventDefault(); void openSelected() }
  if (e.key === 'Escape') { ui.showCommandPalette = false }
  if (e.key === 'Tab') {
    e.preventDefault()
    mode.value = mode.value === 'files' ? 'sessions' : 'files'
  }
}
</script>

<template>
  <div
    v-if="ui.showCommandPalette"
    class="palette-overlay"
    @click.self="ui.showCommandPalette = false"
  >
    <div class="palette-panel">
      <div class="palette-header">
        <Search :size="16" class="text-codex-muted" />
        <input
          v-model="query"
          class="palette-input"
          :placeholder="t('search.placeholder')"
          autofocus
          @keydown="handleKeydown"
        />
        <button type="button" class="palette-close" @click="ui.showCommandPalette = false">
          <X :size="16" />
        </button>
      </div>
      <div class="palette-tabs">
        <button type="button" :class="{ active: mode === 'files' }" @click="mode = 'files'">{{ t('search.files') }}</button>
        <button type="button" :class="{ active: mode === 'sessions' }" @click="mode = 'sessions'">{{ t('search.conversations') }}</button>
      </div>
      <div class="palette-results pretty-scrollbar">
        <template v-if="mode === 'files'">
          <div
            v-for="(item, idx) in fileResults"
            :key="item.path"
            class="palette-item"
            :class="{ active: idx === selected }"
            @click="selected = idx; void openSelected()"
          >
            <span class="item-title">{{ item.name }}</span>
            <span class="item-meta">{{ item.path }}</span>
          </div>
          <div v-if="query && !fileResults.length" class="palette-empty">{{ t('search.noFiles') }}</div>
        </template>
        <template v-else>
          <div
            v-for="(item, idx) in sessionResults"
            :key="item.id"
            class="palette-item"
            :class="{ active: idx === selected }"
            @click="selected = idx; void openSelected()"
          >
            <span class="item-title">{{ item.title }}</span>
          </div>
          <div v-if="query && !sessionResults.length" class="palette-empty">{{ t('search.noSessions') }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-overlay {
  @apply fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/30;
}
.palette-panel {
  @apply w-[520px] overflow-hidden rounded-xl border border-codex-border bg-codex-bg shadow-2xl;
}
.palette-header {
  @apply flex items-center gap-2 border-b border-codex-border px-4 py-3;
}
.palette-input {
  @apply flex-1 bg-transparent text-sm text-codex-text outline-none;
}
.palette-close {
  @apply text-codex-muted hover:text-codex-text;
}
.palette-tabs {
  @apply flex gap-1 border-b border-codex-border px-3 py-2;
}
.palette-tabs button {
  @apply rounded-md px-2.5 py-1 text-[12px] font-medium text-codex-muted hover:bg-codex-hover;
}
.palette-tabs button.active {
  @apply bg-codex-hover text-codex-text;
}
.palette-results {
  @apply max-h-[320px] overflow-y-auto;
}
.palette-item {
  @apply cursor-pointer px-4 py-2.5 hover:bg-codex-hover;
}
.palette-item.active {
  @apply bg-codex-hover;
}
.item-title {
  @apply block text-sm font-medium text-codex-text;
}
.item-meta {
  @apply block text-xs text-codex-muted truncate mt-0.5;
}
.palette-empty {
  @apply px-4 py-3 text-sm text-codex-muted;
}
</style>
