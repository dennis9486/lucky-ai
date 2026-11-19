<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '../../stores/terminal.store.js'

const { t } = useI18n()
const terminal = useTerminalStore()

const activeLines = computed(() => terminal.activeOutputChannel?.lines ?? [])

function selectChannel(channelId: string): void {
  terminal.activeOutputChannelId = channelId
}
</script>

<template>
  <div class="panel-output">
    <div class="output-toolbar">
      <div class="channel-tabs">
        <button
          v-for="channel in terminal.outputChannels"
          :key="channel.id"
          type="button"
          class="channel-tab"
          :class="{ 'is-active': channel.id === terminal.activeOutputChannelId }"
          @click="selectChannel(channel.id)"
        >
          {{ channel.name }}
        </button>
      </div>
      <button type="button" class="toolbar-btn" @click="terminal.clearOutput(terminal.activeOutputChannelId)">
        {{ t('bottomPanel.clearOutput') }}
      </button>
    </div>
    <pre v-if="activeLines.length" class="output-log pretty-scrollbar">{{ activeLines.join('\n') }}</pre>
    <p v-else class="panel-empty">{{ t('bottomPanel.noOutput') }}</p>
  </div>
</template>

<style scoped>
.panel-output {
  @apply flex h-full min-h-0 flex-col;
}
.output-toolbar {
  @apply flex shrink-0 items-center justify-between border-b px-2 py-1;
  border-color: color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.channel-tabs {
  @apply flex min-w-0 items-center gap-1 overflow-x-auto;
}
.channel-tab {
  @apply rounded px-2 py-0.5 text-[11px] font-medium text-codex-muted transition-colors hover:text-codex-text;
}
.channel-tab.is-active {
  @apply bg-codex-hover text-codex-text;
}
.toolbar-btn {
  @apply shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-codex-muted transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.output-log {
  @apply min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-codex-text;
}
.panel-empty {
  @apply flex flex-1 items-center justify-center px-4 text-[12px] text-codex-muted;
}
</style>
