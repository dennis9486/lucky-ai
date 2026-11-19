<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, FolderOpen, Mail, Shield, UserCircle } from 'lucide-vue-next'
import { useAuthStore } from '../../../stores/auth.store.js'
import { useProjectStore } from '../../../stores/project.store.js'
import { useSessionStore } from '../../../stores/session.store.js'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import type { ChronicleSnapshot } from '../../../../shared/types/chronicle.js'

const props = defineProps<{ title: string; description?: string; kind?: string }>()

const { t } = useI18n()
const auth = useAuthStore()
const projects = useProjectStore()
const sessions = useSessionStore()
const settings = useSettingsStore()
const snapshot = ref<ChronicleSnapshot | null>(null)
const loadingSnapshot = ref(false)

const isProfile = computed(() => props.kind === 'profile')
const isSnapshot = computed(() => props.kind === 'app-snapshot')
const enabledProviders = computed(() => settings.providers.filter((provider) => provider.enabled).length)
const visibleSessions = computed(() => sessions.summaries.filter((session) => !session.archivedAt).length)

async function refreshSnapshot(): Promise<void> {
  if (!isSnapshot.value || loadingSnapshot.value) return
  loadingSnapshot.value = true
  try {
    snapshot.value = await unwrap<ChronicleSnapshot>(ipc.chronicle.getSnapshot())
  } finally {
    loadingSnapshot.value = false
  }
}

async function openWorkspace(): Promise<void> {
  if (!projects.activeProject?.rootPath) return
  await unwrap(ipc.app.openPath(projects.activeProject.rootPath))
}

onMounted(() => {
  void refreshSnapshot()
})
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ title }}</h1>
    <p v-if="description" class="panel-desc">{{ description }}</p>

    <template v-if="isProfile">
      <div class="profile-card">
        <div class="avatar">
          <UserCircle :size="34" />
        </div>
        <div class="profile-main">
          <div class="profile-email">{{ auth.displayName ?? auth.email ?? t('settings.placeholder.notSignedIn') }}</div>
          <div class="profile-meta">{{ auth.provider ?? t('settings.placeholder.localProfile') }}</div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-tile">
          <Mail :size="17" />
          <div>
            <div class="tile-label">{{ t('settings.placeholder.account') }}</div>
            <div class="tile-value">{{ auth.email ?? auth.displayName ?? '—' }}</div>
          </div>
        </div>
        <div class="info-tile">
          <Shield :size="17" />
          <div>
            <div class="tile-label">{{ t('settings.placeholder.storage') }}</div>
            <div class="tile-value">{{ t('settings.placeholder.localOnly') }}</div>
          </div>
        </div>
      </div>

      <section class="settings-block">
        <div class="block-title">{{ t('settings.placeholder.profileScope') }}</div>
        <p class="block-desc">{{ t('settings.placeholder.profileScopeDesc') }}</p>
      </section>
    </template>

    <template v-else-if="isSnapshot">
      <div class="snapshot-actions">
        <button type="button" class="primary-btn" :disabled="loadingSnapshot" @click="refreshSnapshot">
          <Camera :size="15" />
          <span>{{ loadingSnapshot ? t('settings.placeholder.loading') : t('settings.placeholder.refreshSnapshot') }}</span>
        </button>
        <button type="button" class="ghost-btn" :disabled="!projects.activeProject?.rootPath" @click="openWorkspace">
          <FolderOpen :size="15" />
          <span>{{ t('titlebar.openLocation') }}</span>
        </button>
      </div>

      <div class="summary-card">
        <div class="summary-row">
          <span>{{ t('settings.placeholder.workspace') }}</span>
          <strong>{{ projects.activeProject?.name ?? t('session.noProject') }}</strong>
        </div>
        <div class="summary-row">
          <span>{{ t('settings.placeholder.activeSessions') }}</span>
          <strong>{{ visibleSessions }}</strong>
        </div>
        <div class="summary-row">
          <span>{{ t('settings.placeholder.enabledProviders') }}</span>
          <strong>{{ enabledProviders }}</strong>
        </div>
      </div>

      <section class="settings-block">
        <div class="block-title">{{ t('settings.placeholder.snapshotThreads') }}</div>
        <div v-if="!snapshot?.threads.length" class="empty-line">{{ t('settings.placeholder.noSnapshotThreads') }}</div>
        <div v-for="thread in snapshot?.threads" :key="thread.sessionId" class="thread-row">
          <div class="thread-title">{{ thread.title }}</div>
          <div class="thread-subtitle">{{ thread.lastUserMessage || thread.lastAssistantSnippet }}</div>
        </div>
      </section>

      <section class="settings-block">
        <div class="block-title">{{ t('settings.placeholder.snapshotMemories') }}</div>
        <div v-if="!snapshot?.memories.length" class="empty-line">{{ t('settings.placeholder.noSnapshotMemories') }}</div>
        <div v-for="memory in snapshot?.memories" :key="memory" class="memory-row">{{ memory }}</div>
      </section>
    </template>

    <div v-else class="placeholder-card">
      <p class="placeholder-text">{{ t('settings.placeholder.comingSoon') }}</p>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text mb-3 tracking-tight;
}
.panel-desc {
  @apply text-[13px] text-codex-muted mb-6 leading-relaxed;
}
.profile-card {
  @apply mb-4 flex items-center gap-4 rounded-xl border border-codex-border bg-codex-bg p-4;
}
.avatar {
  @apply flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-codex-hover text-codex-muted;
}
.profile-main {
  @apply min-w-0;
}
.profile-email {
  @apply truncate text-[16px] font-semibold text-codex-text;
}
.profile-meta {
  @apply mt-1 text-[12px] text-codex-muted;
}
.info-grid {
  @apply mb-4 grid grid-cols-2 gap-3;
}
.info-tile {
  @apply flex items-start gap-3 rounded-xl border border-codex-border bg-codex-bg p-4 text-codex-muted;
}
.tile-label {
  @apply text-[12px] text-codex-muted;
}
.tile-value {
  @apply mt-1 break-all text-[13px] font-medium text-codex-text;
}
.settings-block,
.summary-card {
  @apply mb-4 rounded-xl border border-codex-border bg-codex-bg p-4;
}
.block-title {
  @apply text-[14px] font-semibold text-codex-text;
}
.block-desc,
.empty-line {
  @apply mt-2 text-[12px] leading-relaxed text-codex-muted;
}
.snapshot-actions {
  @apply mb-4 flex items-center gap-2;
}
.primary-btn,
.ghost-btn {
  @apply inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors;
}
.primary-btn {
  @apply bg-codex-text text-codex-bg hover:opacity-90 disabled:opacity-50;
}
.ghost-btn {
  @apply border border-codex-border text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text disabled:opacity-40;
}
.summary-row {
  @apply flex items-center justify-between gap-4 py-2 text-[13px] text-codex-muted;
}
.summary-row + .summary-row {
  @apply border-t border-codex-border;
}
.summary-row strong {
  @apply text-codex-text;
}
.thread-row,
.memory-row {
  @apply mt-3 rounded-lg bg-codex-hover px-3 py-2;
}
.thread-title {
  @apply truncate text-[13px] font-medium text-codex-text;
}
.thread-subtitle,
.memory-row {
  @apply mt-1 line-clamp-2 text-[12px] leading-relaxed text-codex-text-secondary;
}
.placeholder-card {
  @apply rounded-xl border border-codex-border bg-codex-bg px-5 py-10 text-center;
}
.placeholder-text {
  @apply text-[14px] text-codex-muted;
}
</style>
