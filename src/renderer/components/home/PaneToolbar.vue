<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PanelRight } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'

const { t } = useI18n()
const ui = useUiStore()
</script>

<template>
  <div class="pane-toolbar">
    <button
      type="button"
      class="icon-btn"
      :class="{ 'is-active': ui.rightPanelVisible }"
      :title="t('titlebar.panel')"
      @click="ui.toggleRightPanel()"
    >
      <PanelRight :size="17" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.pane-toolbar {
  @apply absolute top-3 right-4 flex items-center gap-1 z-10;
}
.icon-btn {
  @apply p-1.5 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.icon-btn.is-active {
  @apply bg-codex-hover text-codex-text;
}
</style>
