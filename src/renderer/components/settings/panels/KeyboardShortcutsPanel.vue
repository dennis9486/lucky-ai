<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Command, Pencil, RotateCcw, Trash2 } from 'lucide-vue-next'
import {
  KEYBOARD_SHORTCUTS,
  shortcutFromKeyboardEvent,
  shortcutsConflict
} from '../../../../shared/types/shortcuts.js'
import ShortcutKeyCaps from '../ShortcutKeyCaps.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'

const { t } = useI18n()
const settings = useSettingsStore()
const searchQuery = ref('')
const recordingId = ref<string | null>(null)
const conflictMessage = ref('')

const localizedShortcuts = computed(() =>
  KEYBOARD_SHORTCUTS.map((item) => ({
    ...item,
    bindings: settings.keyboardShortcuts[item.id] ?? item.bindings,
    title: t(`settings.shortcuts.items.${item.id}.title`),
    description: t(`settings.shortcuts.items.${item.id}.description`)
  }))
)

const filteredShortcuts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return localizedShortcuts.value
  return localizedShortcuts.value.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
  )
})

async function startRecording(id: string): Promise<void> {
  recordingId.value = id
  conflictMessage.value = ''
}

async function recordShortcut(event: KeyboardEvent, id: string): Promise<void> {
  if (recordingId.value !== id) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    recordingId.value = null
    conflictMessage.value = ''
    return
  }
  const binding = shortcutFromKeyboardEvent(event)
  if (!binding || (!binding.match.mod && !binding.match.alt && !binding.match.shift)) {
    conflictMessage.value = t('settings.shortcuts.invalid')
    return
  }
  const conflictId = shortcutsConflict(settings.keyboardShortcuts, id, binding)
  if (conflictId) {
    const owner = localizedShortcuts.value.find((item) => item.id === conflictId)?.title ?? conflictId
    conflictMessage.value = t('settings.shortcuts.conflict', { command: owner })
    return
  }
  await settings.setKeyboardShortcutBindings(id, [binding])
  recordingId.value = null
  conflictMessage.value = ''
}
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.shortcuts.title') }}</h1>

    <div class="search-wrap">
      <input
        v-model="searchQuery"
        type="search"
        class="search-input"
        :placeholder="t('settings.shortcuts.searchPlaceholder')"
      />
      <span class="search-kbd" aria-hidden="true">
        <Command :size="13" :stroke-width="2" />
      </span>
    </div>

    <div class="shortcuts-table">
      <div class="shortcuts-header">
        <span class="col-command">{{ t('settings.shortcuts.command') }}</span>
        <span class="col-binding">{{ t('settings.shortcuts.binding') }}</span>
        <span class="col-action" />
      </div>

      <div
        v-for="item in filteredShortcuts"
        :key="item.id"
        class="shortcut-row"
      >
        <div class="col-command">
          <div class="command-title">{{ item.title }}</div>
          <div class="command-desc">{{ item.description }}</div>
        </div>

        <div class="col-binding">
          <template v-if="recordingId === item.id">
            <button
              type="button"
              class="recording-btn"
              @keydown="recordShortcut($event, item.id)"
              @blur="recordingId = null"
              autofocus
            >
              {{ conflictMessage || t('settings.shortcuts.recording') }}
            </button>
          </template>
          <template v-else-if="item.unassigned || !item.bindings.length">
            <span class="unassigned">{{ t('settings.shortcuts.unassigned') }}</span>
          </template>
          <template v-else-if="recordingId !== item.id">
            <div
              v-for="(binding, index) in item.bindings"
              :key="index"
              class="binding-group"
            >
              <ShortcutKeyCaps :keys="binding.keys" />
            </div>
          </template>
        </div>

        <div class="col-action">
          <button
            type="button"
            class="action-btn"
            :title="t('settings.shortcuts.edit')"
            @click="startRecording(item.id)"
          >
            <Pencil :size="15" :stroke-width="1.75" />
          </button>
          <button
            type="button"
            class="action-btn"
            :title="t('settings.shortcuts.reset')"
            @click="settings.resetKeyboardShortcut(item.id)"
          >
            <RotateCcw :size="15" :stroke-width="1.75" />
          </button>
          <button
            type="button"
            class="action-btn"
            :title="t('settings.shortcuts.remove')"
            :disabled="!item.bindings.length"
            @click="settings.removeKeyboardShortcutBinding(item.id, 0)"
          >
            <Trash2 :size="15" :stroke-width="1.75" />
          </button>
        </div>
      </div>

      <div v-if="!filteredShortcuts.length" class="empty-row">
        {{ t('settings.shortcuts.empty') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text mb-6 tracking-tight;
}
.search-wrap {
  @apply relative mb-5;
}
.search-input {
  @apply w-full h-[38px] pl-4 pr-11 text-[14px] rounded-[10px] border border-codex-border
         bg-codex-bg text-codex-text outline-none focus:border-codex-accent
         placeholder:text-codex-muted;
}
.search-kbd {
  @apply absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center
         w-7 h-7 rounded-md border border-codex-border bg-codex-hover text-codex-text-secondary;
}
.shortcuts-table {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.shortcuts-header {
  @apply grid grid-cols-[1fr_auto_96px] gap-4 px-4 py-2.5 border-b border-codex-border
         text-[12px] font-medium text-codex-muted;
}
.shortcut-row {
  @apply grid grid-cols-[1fr_auto_96px] gap-4 items-center px-4 py-3.5;
}
.shortcut-row + .shortcut-row {
  @apply border-t border-codex-border;
}
.col-command {
  @apply min-w-0;
}
.command-title {
  @apply text-[14px] font-medium text-codex-text;
}
.command-desc {
  @apply text-[12px] mt-0.5 text-codex-muted;
}
.col-binding {
  @apply flex flex-wrap items-center justify-end gap-2 shrink-0;
}
.binding-group {
  @apply flex items-center;
}
.unassigned {
  @apply text-[13px] text-codex-muted;
}
.col-action {
  @apply flex justify-end;
}
.action-btn {
  @apply p-1.5 rounded-md transition-colors text-codex-muted;
}
.action-btn:not(:disabled):hover {
  @apply bg-codex-hover text-codex-text-secondary;
}
.action-btn:disabled {
  @apply opacity-40 cursor-not-allowed;
}
.recording-btn {
  @apply rounded-md border border-codex-accent px-3 py-1.5 text-[12px] text-codex-text
         bg-codex-hover outline-none min-w-[180px] text-left;
}
.empty-row {
  @apply px-4 py-8 text-center text-[13px] text-codex-muted;
}
</style>
