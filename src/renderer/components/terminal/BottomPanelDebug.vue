<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '../../stores/terminal.store.js'

const { t } = useI18n()
const terminal = useTerminalStore()

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
</script>

<template>
  <div class="panel-debug">
    <div class="debug-toolbar">
      <button type="button" class="toolbar-btn" @click="terminal.clearDebug()">
        {{ t('bottomPanel.clearDebug') }}
      </button>
    </div>
    <div v-if="terminal.debugEntries.length" class="debug-list pretty-scrollbar">
      <div
        v-for="entry in terminal.debugEntries"
        :key="entry.id"
        class="debug-row"
        :class="`is-${entry.level}`"
      >
        <span class="debug-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="debug-level">{{ entry.level }}</span>
        <span class="debug-message">{{ entry.message }}</span>
      </div>
    </div>
    <p v-else class="panel-empty">{{ t('bottomPanel.noDebug') }}</p>
  </div>
</template>

<style scoped>
.panel-debug {
  @apply flex h-full min-h-0 flex-col;
}
.debug-toolbar {
  @apply flex shrink-0 justify-end border-b px-2 py-1;
  border-color: color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.toolbar-btn {
  @apply rounded px-2 py-0.5 text-[11px] font-medium text-codex-muted transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.debug-list {
  @apply min-h-0 flex-1 overflow-auto p-2;
}
.debug-row {
  @apply grid grid-cols-[72px_56px_1fr] gap-2 px-2 py-1 font-mono text-[11px] leading-relaxed;
}
.debug-row.is-error .debug-message { @apply text-red-600; }
.debug-row.is-warn .debug-message { @apply text-amber-600; }
.debug-time,
.debug-level {
  @apply text-codex-muted;
}
.debug-message {
  @apply min-w-0 whitespace-pre-wrap text-codex-text;
}
.panel-empty {
  @apply flex flex-1 items-center justify-center px-4 text-[12px] text-codex-muted;
}
</style>
