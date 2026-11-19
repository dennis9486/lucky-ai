<script setup lang="ts">
/**
 * 浏览器完整设置页（lucky://settings）— Chrome 设置页同构。
 *
 * 布局复用内部页骨架（internal-page/rail/topbar），四个分区：
 * 常规（主页/搜索引擎）、隐私与安全（站点权限/清除数据）、
 * AI 功能（操作授权/页面监控）、数据（历史/下载入口）。
 * 顶部搜索按关键词过滤卡片（与 Chrome 的「搜索设置」同语义）。
 * 快捷项（缩放/打印/UA）保留在工具栏下拉菜单——那是会话态，不属于设置。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Bot,
  Clock3,
  Download,
  Eye,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2
} from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settings.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import {
  BROWSER_SEARCH_URLS,
  type BrowserPageMonitor,
  type BrowserSearchEngine
} from '../../../shared/types/browser.js'
import { normalizeBrowserHomepage } from '../../../shared/utils/browser-url.js'

type SectionId = 'general' | 'privacy' | 'ai' | 'data'
type AgentPolicy = 'auto' | 'ask' | 'block'

const emit = defineEmits<{ 'open-page': [page: 'history' | 'downloads'] }>()

const { t } = useI18n()
const settings = useSettingsStore()

const SEARCH_ENGINES = Object.keys(BROWSER_SEARCH_URLS) as BrowserSearchEngine[]
const ENGINE_LABELS: Record<BrowserSearchEngine, string> = {
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing',
  google: 'Google',
  baidu: '百度'
}

// ── 常规 ──────────────────────────────────────────────────
const homepageDraft = ref(settings.general.browserHomepage)
watch(() => settings.general.browserHomepage, (value) => { homepageDraft.value = value })

const searchEngine = computed<BrowserSearchEngine>({
  get: () => settings.general.browserSearchEngine,
  set: (value) => { void settings.patchGeneral({ browserSearchEngine: value }) }
})

function saveHomepage(): void {
  void settings.patchGeneral({
    browserHomepage: normalizeBrowserHomepage(homepageDraft.value, settings.general.browserHomepage)
  })
}

// ── 管理数据 ──────────────────────────────────────────────
const monitors = ref<BrowserPageMonitor[]>([])
const sitePermissions = ref<Record<string, Record<string, 'allow' | 'deny'>>>({})
const agentPolicies = ref<Record<string, AgentPolicy>>({})
const actionMessage = ref('')

async function loadData(): Promise<void> {
  try {
    monitors.value = await unwrap<BrowserPageMonitor[]>(ipc.browser.listPageMonitors())
  } catch { monitors.value = [] }
  try {
    sitePermissions.value = await unwrap<Record<string, Record<string, 'allow' | 'deny'>>>(ipc.browser.listSitePermissions())
  } catch { sitePermissions.value = {} }
  try {
    agentPolicies.value = await unwrap<Record<string, AgentPolicy>>(ipc.browser.listAgentSitePolicies())
  } catch { agentPolicies.value = {} }
}

/** 所有站点（权限记录 ∪ AI 策略记录），一个站点一行统一管理 */
const siteOrigins = computed(() => {
  const origins = new Set<string>([...Object.keys(sitePermissions.value), ...Object.keys(agentPolicies.value)])
  return [...origins].sort()
})

function agentPolicyFor(origin: string): AgentPolicy {
  return agentPolicies.value[origin] ?? 'ask'
}

async function setAgentPolicy(origin: string, policy: AgentPolicy): Promise<void> {
  await unwrap(ipc.browser.setAgentSitePolicy(origin, policy)).catch(() => undefined)
  await loadData()
}

async function clearSite(origin: string): Promise<void> {
  await unwrap(ipc.browser.clearSitePermissions(origin)).catch(() => undefined)
  await unwrap(ipc.browser.setAgentSitePolicy(origin, 'ask')).catch(() => undefined)
  await loadData()
}

function permissionSummary(origin: string): string {
  const perms = sitePermissions.value[origin]
  if (!perms || !Object.keys(perms).length) return t('browser.settingsNoPermissionRecords')
  return Object.entries(perms)
    .map(([name, decision]) => `${name} ${decision === 'allow' ? '✓' : '✗'}`)
    .join(' · ')
}

async function toggleMonitor(monitor: BrowserPageMonitor): Promise<void> {
  const next = monitor.status === 'active' ? 'paused' : 'active'
  await unwrap(ipc.browser.setPageMonitorStatus(monitor.id, next)).catch(() => undefined)
  await loadData()
}

async function removeMonitor(monitor: BrowserPageMonitor): Promise<void> {
  await unwrap(ipc.browser.removePageMonitor(monitor.id)).catch(() => undefined)
  await loadData()
}

async function clearBrowsingData(): Promise<void> {
  await unwrap(ipc.browser.clearBrowsingData()).catch(() => undefined)
  actionMessage.value = t('browser.settingsDataCleared')
  setTimeout(() => { actionMessage.value = '' }, 3000)
  await loadData()
}

async function clearDownloadRecords(): Promise<void> {
  await unwrap(ipc.browser.clearDownloads()).catch(() => undefined)
  actionMessage.value = t('browser.settingsDownloadsCleared')
  setTimeout(() => { actionMessage.value = '' }, 3000)
}

function monitorTimeLabel(value: number | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

// ── 分区导航 + 搜索过滤 ────────────────────────────────────
const query = ref('')
const activeSection = ref<SectionId>('general')

interface SectionMeta {
  id: SectionId
  labelKey: string
  icon: typeof Settings2
  /** 搜索匹配词（标题 + 卡片关键词，中英混合） */
  keywords: string[]
}

const SECTIONS: SectionMeta[] = [
  { id: 'general', labelKey: 'browser.settingsGeneral', icon: SlidersHorizontal, keywords: ['主页 homepage 搜索引擎 search engine 常规 general'] },
  { id: 'privacy', labelKey: 'browser.settingsPrivacy', icon: ShieldCheck, keywords: ['隐私 安全 privacy security 站点 权限 permission 摄像头 麦克风 定位 通知 清除 浏览数据 clear data'] },
  { id: 'ai', labelKey: 'browser.settingsAi', icon: Sparkles, keywords: ['ai 操作 授权 agent 自动 确认 禁止 监控 monitor 页面变化'] },
  { id: 'data', labelKey: 'browser.settingsData', icon: Clock3, keywords: ['历史 下载 history downloads 记录 数据'] }
]

function sectionMatches(section: SectionMeta): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return `${t(section.labelKey)} ${section.keywords.join(' ')}`.toLowerCase().includes(q)
}

const visibleSections = computed(() => SECTIONS.filter(sectionMatches))

/** 搜索时显示全部命中分区；未搜索时只显示当前分区 */
function sectionShown(id: SectionId): boolean {
  if (query.value.trim()) return visibleSections.value.some((section) => section.id === id)
  return activeSection.value === id
}

onMounted(loadData)
</script>

<template>
  <section class="internal-page">
    <aside class="internal-rail">
      <div class="rail-brand">
        <Settings2 :size="22" />
        <strong>{{ t('browser.settingsTitle') }}</strong>
      </div>
      <button
        v-for="section in SECTIONS"
        :key="section.id"
        type="button"
        class="rail-item"
        :class="{ active: !query.trim() && activeSection === section.id }"
        @click="query = ''; activeSection = section.id"
      >
        <component :is="section.icon" :size="17" />
        <span>{{ t(section.labelKey) }}</span>
      </button>
    </aside>

    <main class="internal-main pretty-scrollbar browser-scroll">
      <div class="internal-topbar">
        <label class="internal-search">
          <Search :size="16" />
          <input v-model="query" :placeholder="t('browser.settingsSearchPlaceholder')" />
        </label>
      </div>

      <p v-if="actionMessage" class="action-toast">{{ actionMessage }}</p>

      <!-- ── 常规 ─────────────────────────────────────── -->
      <template v-if="sectionShown('general')">
        <h2 class="section-heading">{{ t('browser.settingsGeneral') }}</h2>
        <div class="settings-card">
          <div class="card-row">
            <div class="row-text">
              <div class="row-title">{{ t('browser.homepage') }}</div>
              <div class="row-desc">{{ t('browser.settingsHomepageDesc') }}</div>
            </div>
            <input
              v-model="homepageDraft"
              class="row-input"
              type="text"
              :placeholder="t('browser.homepagePlaceholder')"
              @blur="saveHomepage"
              @keydown.enter.prevent="saveHomepage"
            />
          </div>
          <div class="card-row">
            <div class="row-text">
              <div class="row-title">{{ t('browser.searchEngine') }}</div>
              <div class="row-desc">{{ t('browser.settingsSearchEngineDesc') }}</div>
            </div>
            <select v-model="searchEngine" class="row-input row-select">
              <option v-for="engine in SEARCH_ENGINES" :key="engine" :value="engine">{{ ENGINE_LABELS[engine] }}</option>
            </select>
          </div>
        </div>
      </template>

      <!-- ── 隐私与安全 ────────────────────────────────── -->
      <template v-if="sectionShown('privacy')">
        <h2 class="section-heading">{{ t('browser.settingsPrivacy') }}</h2>
        <div class="settings-card">
          <div class="card-head">
            <Eye :size="16" />
            <span>{{ t('browser.sitePermsTitle') }}</span>
          </div>
          <p v-if="!siteOrigins.length" class="card-empty">{{ t('browser.settingsNoSites') }}</p>
          <div v-for="origin in siteOrigins" :key="origin" class="card-row">
            <div class="row-text">
              <div class="row-title mono">{{ origin }}</div>
              <div class="row-desc">{{ permissionSummary(origin) }}</div>
            </div>
            <select
              class="row-input row-select policy-select"
              :value="agentPolicyFor(origin)"
              :title="t('browser.agentPoliciesTitle')"
              @change="setAgentPolicy(origin, ($event.target as HTMLSelectElement).value as 'auto' | 'ask' | 'block')"
            >
              <option value="auto">{{ t('browser.settingsPolicyAuto') }}</option>
              <option value="ask">{{ t('browser.settingsPolicyAsk') }}</option>
              <option value="block">{{ t('browser.settingsPolicyBlock') }}</option>
            </select>
            <button type="button" class="row-icon-btn danger" :title="t('browser.settingsClearSite')" @click="clearSite(origin)">
              <Trash2 :size="15" />
            </button>
          </div>
        </div>

        <div class="settings-card">
          <div class="card-row">
            <div class="row-text">
              <div class="row-title">{{ t('browser.clearData') }}</div>
              <div class="row-desc">{{ t('browser.settingsClearDataDesc') }}</div>
            </div>
            <button type="button" class="danger-action" @click="clearBrowsingData">{{ t('browser.clearData') }}</button>
          </div>
        </div>
      </template>

      <!-- ── AI 功能 ──────────────────────────────────── -->
      <template v-if="sectionShown('ai')">
        <h2 class="section-heading">{{ t('browser.settingsAi') }}</h2>
        <div class="settings-card">
          <div class="card-head">
            <Bot :size="16" />
            <span>{{ t('browser.agentPoliciesTitle') }}</span>
          </div>
          <p class="card-note">{{ t('browser.settingsAgentPolicyDesc') }}</p>
        </div>

        <div class="settings-card">
          <div class="card-head">
            <Eye :size="16" />
            <span>{{ t('browser.monitorsTitle') }}</span>
          </div>
          <p v-if="!monitors.length" class="card-empty">{{ t('browser.settingsNoMonitors') }}</p>
          <div v-for="monitor in monitors" :key="monitor.id" class="card-row">
            <div class="row-text">
              <div class="row-title">
                <em v-if="monitor.aiAnalyze" class="ai-badge">AI</em>
                {{ monitor.title || monitor.url }}
                <em v-if="monitor.status === 'paused'" class="paused-badge">{{ t('browser.settingsMonitorPaused') }}</em>
              </div>
              <div class="row-desc mono">{{ monitor.url }}</div>
              <div class="row-desc">
                {{ t('browser.settingsMonitorMeta', {
                  interval: monitor.intervalMinutes,
                  checked: monitorTimeLabel(monitor.lastCheckedAt),
                  changed: monitorTimeLabel(monitor.lastChangedAt)
                }) }}
                <em v-if="monitor.lastError" class="manage-error">{{ t('browser.monitorError') }}</em>
              </div>
            </div>
            <button
              type="button"
              class="row-icon-btn"
              :title="monitor.status === 'active' ? t('browser.pauseMonitor') : t('browser.resumeMonitor')"
              @click="toggleMonitor(monitor)"
            >
              <Pause v-if="monitor.status === 'active'" :size="15" />
              <Play v-else :size="15" />
            </button>
            <button type="button" class="row-icon-btn danger" :title="t('browser.deleteMonitor')" @click="removeMonitor(monitor)">
              <Trash2 :size="15" />
            </button>
          </div>
        </div>
      </template>

      <!-- ── 数据 ─────────────────────────────────────── -->
      <template v-if="sectionShown('data')">
        <h2 class="section-heading">{{ t('browser.settingsData') }}</h2>
        <div class="settings-card">
          <button type="button" class="card-row card-link" @click="emit('open-page', 'history')">
            <Clock3 :size="16" />
            <div class="row-text">
              <div class="row-title">{{ t('browser.history') }}</div>
              <div class="row-desc">{{ t('browser.settingsHistoryDesc') }}</div>
            </div>
          </button>
          <button type="button" class="card-row card-link" @click="emit('open-page', 'downloads')">
            <Download :size="16" />
            <div class="row-text">
              <div class="row-title">{{ t('browser.downloads') }}</div>
              <div class="row-desc">{{ t('browser.settingsDownloadsDesc') }}</div>
            </div>
          </button>
          <div class="card-row">
            <div class="row-text">
              <div class="row-title">{{ t('browser.settingsClearDownloads') }}</div>
              <div class="row-desc">{{ t('browser.settingsClearDownloadsDesc') }}</div>
            </div>
            <button type="button" class="danger-action" @click="clearDownloadRecords">{{ t('browser.settingsClearDownloads') }}</button>
          </div>
        </div>
      </template>

      <p v-if="query.trim() && !visibleSections.length" class="card-empty center">{{ t('browser.settingsNoResults') }}</p>
    </main>
  </section>
</template>

<style scoped>
.internal-page {
  @apply flex h-full w-full overflow-hidden bg-codex-bg text-codex-text;
}
.internal-rail {
  @apply w-[280px] shrink-0 border-r border-codex-border bg-codex-sidebar px-3 py-5;
}
.rail-brand {
  @apply mb-5 flex items-center gap-3 px-2 text-[21px] font-semibold;
}
.rail-brand svg {
  @apply text-codex-accent;
}
.rail-item {
  @apply flex h-9 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[13px] font-medium text-codex-text transition-colors;
}
.rail-item:hover,
.rail-item.active {
  @apply bg-codex-sidebar-hover text-codex-text;
}
.internal-main {
  @apply min-w-0 flex-1 overflow-y-auto px-8 py-6;
}
.internal-topbar {
  @apply sticky top-0 z-10 mb-8 flex justify-center pb-3;
  background: color-mix(in srgb, var(--codex-bg) 95%, transparent);
}
.internal-search {
  @apply flex h-10 w-full max-w-[760px] items-center gap-3 rounded-[10px] border border-codex-border bg-codex-sidebar px-4 text-codex-muted transition-colors;
}
.internal-search:focus-within {
  @apply border-codex-accent bg-codex-bg;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-accent) 14%, transparent);
}
.internal-search input {
  @apply min-w-0 flex-1 bg-transparent text-[14px] text-codex-text outline-none placeholder:text-codex-muted;
}
.section-heading {
  @apply mx-auto mb-3 mt-2 w-full max-w-[760px] text-[16px] font-semibold text-codex-text;
}
.settings-card {
  @apply mx-auto mb-5 w-full max-w-[760px] overflow-hidden rounded-[10px] border border-codex-border bg-codex-bg;
}
.card-head {
  @apply flex items-center gap-2 border-b border-codex-border px-5 py-3 text-[13px] font-semibold text-codex-text;
}
.card-head svg {
  @apply text-codex-accent;
}
.card-note {
  @apply px-5 py-3 text-[13px] leading-relaxed text-codex-text-secondary;
}
.card-empty {
  @apply px-5 py-4 text-[13px] text-codex-muted;
}
.card-empty.center {
  @apply mx-auto max-w-[820px] text-center;
}
.card-row {
  @apply flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors;
}
.card-row + .card-row {
  @apply border-t border-codex-border;
}
.card-link {
  @apply cursor-pointer hover:bg-codex-hover;
}
.card-link svg {
  @apply shrink-0 text-codex-text-secondary;
}
.row-text {
  @apply min-w-0 flex-1;
}
.row-title {
  @apply flex items-center gap-2 text-[14px] font-medium text-codex-text;
}
.row-title.mono {
  @apply font-mono text-[13px];
}
.row-desc {
  @apply mt-0.5 truncate text-[12px] text-codex-text-secondary;
}
.row-desc.mono {
  @apply font-mono;
}
.row-input {
  @apply h-9 w-[260px] shrink-0 rounded-[8px] border border-codex-border bg-codex-sidebar px-3 text-[13px] text-codex-text outline-none
         transition-colors focus:border-codex-accent focus:bg-codex-bg placeholder:text-codex-muted;
}
.row-select {
  @apply w-[180px];
}
.policy-select {
  @apply w-[150px];
}
.row-icon-btn {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-codex-text-secondary transition-colors
         hover:bg-codex-hover hover:text-codex-text;
}
.row-icon-btn.danger:hover {
  @apply text-red-500;
}
.danger-action {
  @apply h-9 shrink-0 rounded-[8px] border border-red-200 bg-red-50 px-3 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-100;
}
.ai-badge {
  @apply rounded px-1 not-italic text-[10px] font-semibold text-codex-accent;
  background: color-mix(in srgb, var(--codex-accent) 15%, transparent);
}
.paused-badge {
  @apply rounded px-1 not-italic text-[10px] font-semibold text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 8%, transparent);
}
.manage-error {
  @apply ml-1 not-italic text-[11px] text-red-500;
}
.action-toast {
  @apply mx-auto mb-4 w-full max-w-[760px] rounded-[8px] px-4 py-2.5 text-[13px] font-medium text-green-700;
  background: color-mix(in srgb, #16a34a 10%, transparent);
}
</style>
