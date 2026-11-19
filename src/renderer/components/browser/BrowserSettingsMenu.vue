<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Minus, Pause, Play, Plus, Printer, Smartphone, Trash2, VenetianMask } from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settings.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { BROWSER_SEARCH_URLS, type BrowserPageMonitor, type BrowserSearchEngine } from '../../../shared/types/browser.js'
import { normalizeBrowserHomepage } from '../../../shared/utils/browser-url.js'

const SEARCH_ENGINES = Object.keys(BROWSER_SEARCH_URLS) as BrowserSearchEngine[]
const ENGINE_LABELS: Record<BrowserSearchEngine, string> = {
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing',
  google: 'Google',
  baidu: '百度'
}

defineProps<{
  zoomPercent: number
  isDesktopMode: boolean
  hasPage: boolean
}>()

const emit = defineEmits<{
  close: []
  'zoom-in': []
  'zoom-out': []
  'reset-zoom': []
  'toggle-desktop': []
  print: []
  'new-incognito': []
  'clear-data': []
}>()

const { t } = useI18n()
const settings = useSettingsStore()
const homepageDraft = ref(settings.general.browserHomepage)

watch(() => settings.general.browserHomepage, (value) => { homepageDraft.value = value })

const searchEngine = computed<BrowserSearchEngine>({
  get: () => settings.general.browserSearchEngine,
  set: (v) => { void settings.patchGeneral({ browserSearchEngine: v }) }
})

function saveHomepage(): void {
  void settings.patchGeneral({
    browserHomepage: normalizeBrowserHomepage(homepageDraft.value, settings.general.browserHomepage)
  })
}

// ---- 页面监控 / 站点权限管理 --------------------------------------------------
const monitors = ref<BrowserPageMonitor[]>([])
const sitePermissions = ref<Record<string, Record<string, 'allow' | 'deny'>>>({})
const agentPolicies = ref<Record<string, 'auto' | 'ask' | 'block'>>({})

async function loadManageData(): Promise<void> {
  try {
    monitors.value = await unwrap<BrowserPageMonitor[]>(ipc.browser.listPageMonitors())
  } catch { monitors.value = [] }
  try {
    sitePermissions.value = await unwrap<Record<string, Record<string, 'allow' | 'deny'>>>(ipc.browser.listSitePermissions())
  } catch { sitePermissions.value = {} }
  try {
    agentPolicies.value = await unwrap<Record<string, 'auto' | 'ask' | 'block'>>(ipc.browser.listAgentSitePolicies())
  } catch { agentPolicies.value = {} }
}

/** 恢复该站点的 AI 操作策略为默认（逐次确认） */
async function resetAgentPolicy(origin: string): Promise<void> {
  await unwrap(ipc.browser.setAgentSitePolicy(origin, 'ask')).catch(() => undefined)
  await loadManageData()
}

async function toggleMonitor(monitor: BrowserPageMonitor): Promise<void> {
  const next = monitor.status === 'active' ? 'paused' : 'active'
  await unwrap(ipc.browser.setPageMonitorStatus(monitor.id, next)).catch(() => undefined)
  await loadManageData()
}

async function removeMonitor(monitor: BrowserPageMonitor): Promise<void> {
  await unwrap(ipc.browser.removePageMonitor(monitor.id)).catch(() => undefined)
  await loadManageData()
}

async function clearSitePermission(origin: string): Promise<void> {
  await unwrap(ipc.browser.clearSitePermissions(origin)).catch(() => undefined)
  await loadManageData()
}

function sitePermissionSummary(perms: Record<string, 'allow' | 'deny'>): string {
  return Object.entries(perms).map(([name, decision]) => `${name}:${decision === 'allow' ? '✓' : '✗'}`).join(' · ')
}

onMounted(loadManageData)
</script>

<template>
  <div class="menu-scrim" @mousedown="emit('close')" />
  <div class="settings-menu" role="menu">
    <div class="menu-section">
      <label class="menu-label">{{ t('browser.homepage') }}</label>
      <input
        v-model="homepageDraft"
        class="menu-input"
        type="text"
        :placeholder="t('browser.homepagePlaceholder')"
        @blur="saveHomepage"
        @keydown.enter.prevent="saveHomepage"
      />
    </div>
    <div class="menu-section">
      <label class="menu-label">{{ t('browser.searchEngine') }}</label>
      <select v-model="searchEngine" class="menu-input">
        <option v-for="engine in SEARCH_ENGINES" :key="engine" :value="engine">{{ ENGINE_LABELS[engine] }}</option>
      </select>
    </div>
    <div class="menu-divider" />
    <div class="menu-row">
      <span class="menu-row-label">{{ t('browser.zoom') }}</span>
      <div class="zoom-controls">
        <button type="button" class="menu-icon-btn" :title="t('browser.zoomOut')" @click="emit('zoom-out')"><Minus :size="14" /></button>
        <button type="button" class="zoom-value" :title="t('browser.resetZoom')" @click="emit('reset-zoom')">{{ zoomPercent }}%</button>
        <button type="button" class="menu-icon-btn" :title="t('browser.zoomIn')" @click="emit('zoom-in')"><Plus :size="14" /></button>
      </div>
    </div>
    <button type="button" class="menu-item" :disabled="!hasPage" @click="emit('toggle-desktop')">
      <Smartphone :size="15" />
      <span>{{ isDesktopMode ? t('browser.requestMobile') : t('browser.requestDesktop') }}</span>
    </button>
    <button type="button" class="menu-item" :disabled="!hasPage" @click="emit('print')">
      <Printer :size="15" />
      <span>{{ t('browser.print') }}</span>
    </button>
    <div class="menu-divider" />
    <button type="button" class="menu-item" @click="emit('new-incognito')">
      <VenetianMask :size="15" />
      <span>{{ t('browser.newIncognito') }}</span>
    </button>
    <div v-if="monitors.length" class="menu-section">
      <label class="menu-label">{{ t('browser.monitorsTitle') }}</label>
      <div v-for="monitor in monitors" :key="monitor.id" class="manage-row">
        <span class="manage-text" :title="monitor.url">
          <em v-if="monitor.aiAnalyze" class="manage-ai" :title="t('browser.monitorAiBadge')">AI</em>
          {{ monitor.title || monitor.url }}
          <em v-if="monitor.lastError" class="manage-error">{{ t('browser.monitorError') }}</em>
        </span>
        <button
          type="button"
          class="menu-icon-btn"
          :title="monitor.status === 'active' ? t('browser.pauseMonitor') : t('browser.resumeMonitor')"
          @click="toggleMonitor(monitor)"
        >
          <Pause v-if="monitor.status === 'active'" :size="13" />
          <Play v-else :size="13" />
        </button>
        <button type="button" class="menu-icon-btn danger" :title="t('browser.deleteMonitor')" @click="removeMonitor(monitor)">
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div v-if="Object.keys(agentPolicies).length" class="menu-section">
      <label class="menu-label">{{ t('browser.agentPoliciesTitle') }}</label>
      <div v-for="(policy, origin) in agentPolicies" :key="origin" class="manage-row">
        <span class="manage-text" :title="String(origin)">
          <em class="manage-ai" :class="{ 'is-block': policy === 'block' }">{{ policy === 'auto' ? t('browser.agentPolicyAutoShort') : t('browser.agentPolicyBlockShort') }}</em>
          {{ origin }}
        </span>
        <button type="button" class="menu-icon-btn danger" :title="t('browser.agentPolicyReset')" @click="resetAgentPolicy(String(origin))">
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div v-if="Object.keys(sitePermissions).length" class="menu-section">
      <label class="menu-label">{{ t('browser.sitePermsTitle') }}</label>
      <div v-for="(perms, origin) in sitePermissions" :key="origin" class="manage-row">
        <span class="manage-text" :title="sitePermissionSummary(perms)">{{ origin }}</span>
        <button type="button" class="menu-icon-btn danger" :title="t('browser.clearSitePerms')" @click="clearSitePermission(String(origin))">
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <button type="button" class="menu-item danger" @click="emit('clear-data')">
      <Trash2 :size="15" />
      <span>{{ t('browser.clearData') }}</span>
    </button>
  </div>
</template>

<style scoped>
.menu-scrim {
  @apply fixed inset-0 z-[60];
}
.settings-menu {
  @apply absolute right-2 top-[86px] z-[61] w-[260px] rounded-xl border border-codex-border bg-codex-bg p-2 shadow-2xl;
}
.menu-section {
  @apply px-2 py-1.5;
}
.menu-label {
  @apply mb-1 block text-[11px] font-semibold uppercase tracking-wide text-codex-muted;
}
.menu-input {
  @apply h-8 w-full rounded-lg border border-codex-border bg-codex-hover px-2.5 text-[13px] text-codex-text outline-none
         focus:border-codex-border-hover;
}
.menu-divider {
  @apply my-1.5 h-px bg-codex-border;
}
.menu-row {
  @apply flex items-center justify-between px-2 py-1.5;
}
.menu-row-label {
  @apply text-[13px] font-medium text-codex-text;
}
.zoom-controls {
  @apply flex items-center gap-1;
}
.menu-icon-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-muted hover:bg-codex-hover hover:text-codex-text;
}
.menu-icon-btn.danger:hover {
  @apply text-red-500;
}
.manage-row {
  @apply flex items-center gap-1 py-0.5;
}
.manage-text {
  @apply min-w-0 flex-1 truncate text-[12px] text-codex-text;
}
.manage-error {
  @apply ml-1 not-italic text-[11px] text-red-500;
}
.manage-ai {
  @apply mr-1 rounded px-1 not-italic text-[10px] font-semibold text-codex-accent;
  background: color-mix(in srgb, var(--codex-accent) 15%, transparent);
}
.manage-ai.is-block {
  @apply text-red-500;
  background: color-mix(in srgb, #ef4444 12%, transparent);
}
.zoom-value {
  @apply min-w-[48px] rounded-md px-1 text-center text-[12px] font-semibold text-codex-text hover:bg-codex-hover;
}
.menu-item {
  @apply flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-codex-text
         transition-colors hover:bg-codex-hover disabled:cursor-not-allowed disabled:opacity-40;
}
.menu-item.danger {
  @apply text-red-600 hover:bg-red-50;
}
:global([data-theme='dark']) .menu-item.danger {
  @apply text-red-400 hover:bg-red-950/40;
}
</style>
