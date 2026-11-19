<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, GitBranch, MessageSquare, Paperclip, X } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'
import { useSessionStore } from '../../stores/session.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import type { WorkspaceGitStatus } from '../../../shared/types/workspace.js'

const { t } = useI18n()
const ui = useUiStore()
const sessions = useSessionStore()
const projects = useProjectStore()
const gitStatus = ref<WorkspaceGitStatus | null>(null)

const activeSession = computed(() => sessions.activeSession)
const messageCount = computed(() => activeSession.value?.messages.length ?? 0)
const lastMessage = computed(() => {
  const messages = activeSession.value?.messages ?? []
  return messages[messages.length - 1]?.content ?? ''
})

async function refreshGit(): Promise<void> {
  const root = projects.activeProject?.rootPath
  if (!root) {
    gitStatus.value = null
    return
  }
  try {
    gitStatus.value = await unwrap<WorkspaceGitStatus>(ipc.workspace.getGitStatus(root))
  } catch {
    gitStatus.value = null
  }
}

watch(() => projects.activeProject?.rootPath, () => { void refreshGit() })
onMounted(() => { void refreshGit() })
</script>

<template>
  <aside class="right-panel">
    <div class="panel-header">
      <div>
        <div class="panel-title">{{ t('rightPanel.title') }}</div>
        <div class="panel-subtitle">{{ t('rightPanel.subtitle') }}</div>
      </div>
      <button type="button" class="icon-btn" :title="t('common.close')" @click="ui.rightPanelVisible = false">
        <X :size="16" />
      </button>
    </div>

    <div class="panel-scroll pretty-scrollbar">
      <section class="info-section">
        <div class="section-title">
          <Folder :size="15" />
          <span>{{ t('rightPanel.workspace') }}</span>
        </div>
        <div class="info-card">
          <div class="info-main">{{ projects.activeProject?.name ?? t('session.noProject') }}</div>
          <div class="info-muted">{{ projects.activeProject?.rootPath ?? t('rightPanel.noWorkspace') }}</div>
        </div>
      </section>

      <section class="info-section">
        <div class="section-title">
          <GitBranch :size="15" />
          <span>{{ t('rightPanel.git') }}</span>
        </div>
        <div class="info-card">
          <template v-if="gitStatus?.isRepository">
            <div class="info-main">{{ gitStatus.branch ?? gitStatus.head ?? 'HEAD' }}</div>
            <div class="info-muted">
              {{ t('rightPanel.dirtyFiles', { count: gitStatus.dirtyCount }) }}
              <span v-if="gitStatus.ahead || gitStatus.behind">
                · {{ t('rightPanel.aheadBehind', { ahead: gitStatus.ahead ?? 0, behind: gitStatus.behind ?? 0 }) }}
              </span>
            </div>
          </template>
          <div v-else class="info-muted">{{ t('rightPanel.notGit') }}</div>
        </div>
      </section>

      <section class="info-section">
        <div class="section-title">
          <MessageSquare :size="15" />
          <span>{{ t('rightPanel.session') }}</span>
        </div>
        <div class="info-card">
          <div class="info-main">{{ activeSession?.title ?? t('session.newChat') }}</div>
          <div class="info-muted">{{ t('rightPanel.messageCount', { count: messageCount }) }}</div>
          <p v-if="lastMessage" class="last-message">{{ lastMessage }}</p>
        </div>
      </section>

      <section class="info-section">
        <div class="section-title">
          <Paperclip :size="15" />
          <span>{{ t('rightPanel.attachments') }}</span>
        </div>
        <div class="info-card">
          <div v-if="!ui.composerAttachments.length" class="info-muted">{{ t('rightPanel.noAttachments') }}</div>
          <div v-for="item in ui.composerAttachments" :key="item.path" class="attachment-row">
            <span class="attachment-name">{{ item.name }}</span>
            <span class="attachment-kind">{{ item.kind }}</span>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.right-panel {
  @apply w-[320px] shrink-0 border-l border-codex-border bg-codex-bg flex flex-col min-h-0;
}
.panel-header {
  @apply h-[58px] shrink-0 flex items-center justify-between gap-3 border-b border-codex-border px-4;
}
.panel-title {
  @apply text-[13px] font-semibold text-codex-text;
}
.panel-subtitle {
  @apply mt-0.5 text-[11px] text-codex-muted;
}
.icon-btn {
  @apply rounded-lg p-1.5 text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.panel-scroll {
  @apply flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5;
}
.info-section {
  @apply space-y-2;
}
.section-title {
  @apply flex items-center gap-1.5 text-[12px] font-medium text-codex-text-secondary;
}
.info-card {
  @apply rounded-xl border border-codex-border bg-codex-sidebar px-3 py-2.5;
}
.info-main {
  @apply truncate text-[13px] font-medium text-codex-text;
}
.info-muted {
  @apply mt-1 break-words text-[11px] leading-relaxed text-codex-muted;
}
.last-message {
  @apply mt-2 line-clamp-4 text-[12px] leading-relaxed text-codex-text-secondary;
}
.attachment-row {
  @apply flex items-center justify-between gap-3 py-1 text-[12px];
}
.attachment-name {
  @apply min-w-0 truncate text-codex-text;
}
.attachment-kind {
  @apply shrink-0 rounded-md bg-codex-hover px-1.5 py-0.5 text-[10px] uppercase text-codex-muted;
}
</style>
