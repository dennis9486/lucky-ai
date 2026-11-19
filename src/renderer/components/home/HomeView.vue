<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import WelcomeHeading from './WelcomeHeading.vue'
import ComposerSection from './ComposerSection.vue'
import IntegrationCards from './IntegrationCards.vue'
import { useChatStore } from '../../stores/chat.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useProjectStore } from '../../stores/project.store.js'

const { t } = useI18n()

const chat = useChatStore()
const ui = useUiStore()
const sessions = useSessionStore()
const projects = useProjectStore()

async function handleSend(): Promise<void> {
  if (!chat.input.trim() && ui.composerAttachments.length === 0) return
  const ready = await projects.ensureWorkspace()
  if (!ready) return
  await sessions.ensureActiveSession()
  ui.currentView = 'chat'
  await chat.sendMessage()
}
</script>

<template>
  <div class="home-view pretty-scrollbar">
    <div class="home-content">
      <div class="home-stack">
        <WelcomeHeading />
        <ComposerSection
          :placeholder="t('composer.placeholderHome')"
          popover-placement="above"
          @send="handleSend"
        />
        <IntegrationCards v-if="!projects.hasWorkspace" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  @apply flex-1 flex flex-col bg-codex-bg overflow-y-auto relative min-h-0;
}
.home-content {
  @apply flex-1 flex flex-col items-center justify-center px-10 py-14 w-full min-h-0;
}
.home-stack {
  @apply w-full max-w-[var(--content-measure)] flex flex-col;
}
</style>
