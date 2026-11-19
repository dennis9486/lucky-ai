<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCw, Plus, Settings2, FlaskConical } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import McpServerForm from './McpServerForm.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import { toIpcPlain } from '../../../utils/ipc-serialize.js'
import { MCP_PLUGIN_SERVERS, userMcpServers } from '../../../../shared/types/mcp.js'
import type { McpServerTestResult } from '../../../../shared/types/ipc.js'

const { t } = useI18n()
const settings = useSettingsStore()

const view = ref<'list' | 'form'>('list')
const editingId = ref<string | null>(null)
const restarting = ref(false)
const testingId = ref<string | null>(null)
const testResults = ref<Record<string, McpServerTestResult>>({})

const userServers = computed(() => userMcpServers(settings.mcpServers))

function openAdd(): void {
  editingId.value = null
  view.value = 'form'
}

function openEdit(id: string): void {
  editingId.value = id
  view.value = 'form'
}

function backToList(): void {
  view.value = 'list'
  editingId.value = null
}

async function toggleServer(id: string, enabled: boolean): Promise<void> {
  await settings.toggleMcpServer(id, enabled)
}

async function restartServers(): Promise<void> {
  restarting.value = true
  try {
    await unwrap(ipc.agent.reset())
  } finally {
    restarting.value = false
  }
}

async function testServer(id: string): Promise<void> {
  const server = settings.mcpServers.find((item) => item.id === id)
  if (!server) return
  testingId.value = id
  try {
    const result = await unwrap<McpServerTestResult>(ipc.agent.testMcp(toIpcPlain(server)))
    testResults.value = { ...testResults.value, [id]: result }
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [id]: {
        serverId: id,
        ok: false,
        tools: [],
        error: String(e)
      }
    }
  } finally {
    testingId.value = null
  }
}

function getTestResult(id: string): McpServerTestResult | undefined {
  return testResults.value[id]
}

function getTestTitle(id: string): string {
  const result = getTestResult(id)
  if (!result) return ''
  return result.error || result.tools.map((tool) => tool.name).join(', ')
}

function getTestLabel(id: string): string {
  const result = getTestResult(id)
  if (!result) return ''
  return result.ok
    ? t('settings.mcp.testTools', { count: result.tools.length })
    : t('settings.mcp.testFailed')
}
</script>

<template>
  <McpServerForm
    v-if="view === 'form'"
    :server-id="editingId"
    @back="backToList"
    @saved="backToList"
  />

  <div v-else class="settings-panel">
    <div class="panel-header">
      <div>
        <h1 class="panel-title">{{ t('settings.mcp.title') }}</h1>
        <p class="panel-desc">
          {{ t('settings.mcp.description') }}
          <a href="#" class="desc-link" @click.prevent>{{ t('settings.mcp.learnMore') }}</a>
        </p>
      </div>
      <button
        type="button"
        class="restart-btn"
        :disabled="restarting"
        @click="restartServers()"
      >
        <RotateCw :size="14" :stroke-width="1.75" :class="{ 'is-spinning': restarting }" />
        <span>{{ t('settings.mcp.restart') }}</span>
      </button>
    </div>

    <section class="settings-section">
      <div class="section-header">
        <h2 class="section-title">{{ t('settings.mcp.servers') }}</h2>
        <button type="button" class="add-btn" @click="openAdd">
          <Plus :size="14" :stroke-width="1.75" />
          <span>{{ t('settings.mcp.addServer') }}</span>
        </button>
      </div>

      <div v-if="userServers.length" class="settings-group">
        <div
          v-for="server in userServers"
          :key="server.id"
          class="server-row"
        >
          <span class="server-name">{{ server.name }}</span>
          <div class="server-actions">
            <span
              v-if="getTestResult(server.id)"
              class="test-status"
              :class="{ 'is-ok': getTestResult(server.id)?.ok, 'is-error': !getTestResult(server.id)?.ok }"
              :title="getTestTitle(server.id)"
            >
              {{ getTestLabel(server.id) }}
            </span>
            <button
              type="button"
              class="icon-btn"
              :title="t('settings.mcp.testConnection')"
              :disabled="testingId === server.id"
              @click="testServer(server.id)"
            >
              <FlaskConical :size="16" :stroke-width="1.75" :class="{ 'is-spinning': testingId === server.id }" />
            </button>
            <button
              type="button"
              class="icon-btn"
              :title="t('settings.mcp.edit')"
              @click="openEdit(server.id)"
            >
              <Settings2 :size="16" :stroke-width="1.75" />
            </button>
            <SettingsToggle
              :model-value="server.enabled"
              @update:model-value="toggleServer(server.id, $event)"
            />
          </div>
        </div>
      </div>

      <div v-else class="empty-card">
        <p class="empty-text">{{ t('settings.mcp.emptyText') }}</p>
        <button type="button" class="empty-add-btn" @click="openAdd">{{ t('settings.mcp.emptyAddBtn') }}</button>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title mb-3">{{ t('settings.mcp.fromPlugins') }}</h2>
      <div class="settings-group">
        <div
          v-for="plugin in MCP_PLUGIN_SERVERS"
          :key="plugin.id"
          class="plugin-row"
        >
          {{ plugin.name }}
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-header {
  @apply flex items-start justify-between gap-4 mb-8;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text tracking-tight mb-1;
}
.panel-desc {
  @apply text-[13px] text-codex-muted leading-relaxed;
}
.desc-link {
  @apply text-codex-accent hover:underline;
}
.restart-btn {
  @apply flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg border border-codex-border
         bg-codex-bg hover:bg-codex-hover transition-colors shrink-0 disabled:opacity-50;
}
.is-spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.settings-section {
  @apply mb-8;
}
.section-header {
  @apply flex items-center justify-between mb-3;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text;
}
.add-btn {
  @apply flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg border border-codex-border
         bg-codex-hover hover:bg-codex-bg transition-colors;
}
.settings-group {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.server-row {
  @apply flex items-center justify-between gap-4 px-4 py-3.5;
}
.server-row + .server-row {
  @apply border-t border-codex-border;
}
.server-name {
  @apply text-[14px] font-medium text-codex-text;
}
.server-actions {
  @apply flex items-center gap-3 shrink-0;
}
.test-status {
  @apply text-[12px] px-2 py-0.5 rounded-md bg-codex-hover text-codex-muted;
}
.test-status.is-ok {
  @apply bg-emerald-50 text-emerald-700;
}
.test-status.is-error {
  @apply bg-red-50 text-red-600;
}
.icon-btn {
  @apply p-1.5 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.icon-btn:disabled {
  @apply opacity-50 cursor-not-allowed;
}
.plugin-row {
  @apply px-4 py-3.5 text-[14px] text-codex-text;
}
.plugin-row + .plugin-row {
  @apply border-t border-codex-border;
}
.empty-card {
  @apply rounded-xl border border-codex-border bg-codex-bg px-4 py-8 text-center;
}
.empty-text {
  @apply text-[13px] text-codex-muted mb-3;
}
.empty-add-btn {
  @apply px-4 py-1.5 text-[13px] rounded-lg border border-codex-border
         hover:bg-codex-hover transition-colors;
}
</style>
