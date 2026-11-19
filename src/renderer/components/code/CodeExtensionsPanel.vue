<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRight,
  Download,
  Ellipsis,
  ExternalLink,
  ListFilter,
  ListX,
  Package,
  Play,
  RefreshCw,
  Search
} from 'lucide-vue-next'
import type { ExtensionManifestSummary, ExtensionRecommendations, MarketplaceExtension } from '../../../shared/types/extension.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { getExtensionActivationSummary, runExtensionCommand } from '../../services/extension-host.service.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { extensionsRevision, notifyExtensionsChanged } from '../../stores/extension-events.js'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'

const { t } = useI18n()
const editor = useEditorStore()
const ui = useUiStore()
const cardMenu = ref<{ x: number; y: number; item: ExtensionManifestSummary } | null>(null)
const loading = ref(false)
const installing = ref(false)
const searchQuery = ref('')
const installedOpen = ref(true)
const recommendationsOpen = ref(true)
const commandsOpen = ref(false)
const runningOnly = ref(false)
const installed = ref<ExtensionManifestSummary[]>([])
const recommendations = ref<ExtensionRecommendations>({ recommendations: [], unwantedRecommendations: [] })
const menu = ref<{ x: number; y: number } | null>(null)
const marketplaceOpen = ref(true)
const marketResults = ref<MarketplaceExtension[]>([])
const marketLoading = ref(false)
const marketError = ref('')
const installingId = ref<string | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const activation = computed(() => getExtensionActivationSummary())
const runtimeCommands = computed(() => activation.value.runtime?.registeredCommands ?? [])
const activationErrors = computed(() => new Map(
  (activation.value.runtime?.failed ?? []).map((item) => [item.extensionId, item.error])
))
const searchKeyword = computed(() => searchQuery.value.trim().toLowerCase())
const filteredInstalled = computed(() => installed.value.filter((item) => {
  if (runningOnly.value && !isActiveExtension(item)) return false
  return matchesExtension(item, searchKeyword.value)
}))
const filteredRecommendations = computed(() => recommendations.value.recommendations.filter((id) => (
  !searchKeyword.value || id.toLowerCase().includes(searchKeyword.value)
)))
const filteredRuntimeCommands = computed(() => runtimeCommands.value.filter((command) => (
  !searchKeyword.value || command.toLowerCase().includes(searchKeyword.value)
)))
const enabledInstalledCount = computed(() => installed.value.filter((item) => item.enabled).length)
const hasSearch = computed(() => searchKeyword.value.length > 0)
const hasVisibleContent = computed(() => (
  filteredInstalled.value.length > 0
  || filteredRecommendations.value.length > 0
  || filteredRuntimeCommands.value.length > 0
  || marketResults.value.length > 0
  || marketLoading.value
))

const menuItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'view',
    label: t('extensions.menu.view'),
    submenu: [
      { id: 'toggle-installed', label: installedOpen.value ? t('extensions.menu.hideInstalled') : t('extensions.menu.showInstalled') },
      { id: 'toggle-recommendations', label: recommendationsOpen.value ? t('extensions.menu.hideRecommended') : t('extensions.menu.showRecommended') },
      { id: 'toggle-commands', label: commandsOpen.value ? t('extensions.menu.hideRuntimeCommands') : t('extensions.menu.showRuntimeCommands') }
    ]
  },
  { id: 'check-updates', label: t('extensions.menu.checkUpdates') },
  { id: 'disable-auto-updates', label: t('extensions.menu.disableAutoUpdates'), disabled: true },
  { id: 'account-preferences', label: t('extensions.menu.accountPreferences'), disabled: true },
  { id: 'sep-1', separator: true },
  { id: 'enable-all', label: t('extensions.menu.enableAll'), disabled: enabledInstalledCount.value === installed.value.length },
  { id: 'disable-all', label: t('extensions.menu.disableAll'), disabled: enabledInstalledCount.value === 0 },
  { id: 'show-running', label: runningOnly.value ? t('extensions.menu.showAll') : t('extensions.menu.showRunning') },
  { id: 'bisect', label: t('extensions.menu.startBisect'), disabled: true },
  { id: 'sep-2', separator: true },
  { id: 'install-folder', label: t('extensions.menu.installFromFolder') }
])

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [list, recs] = await Promise.all([
      unwrap<ExtensionManifestSummary[]>(ipc.extension.listInstalled()),
      unwrap<ExtensionRecommendations>(ipc.extension.getRecommendations())
    ])
    installed.value = list
    recommendations.value = recs
  } finally {
    loading.value = false
  }
}

function isInstalled(id: string): boolean {
  return installed.value.some((item) => item.id === id || item.id.endsWith(`.${id}`))
}

/** 点击已安装扩展卡片 → 在右侧编辑器区打开详情页。 */
function openDetail(id: string): void {
  editor.openExtensionDetail(id)
}

function openCardMenu(item: ExtensionManifestSummary, event: MouseEvent): void {
  cardMenu.value = { x: event.clientX, y: event.clientY, item }
}

const cardMenuItems = computed<ContextMenuItem[]>(() => {
  const item = cardMenu.value?.item
  if (!item) return []
  return [
    { id: 'detail', label: t('extensions.viewDetails') },
    { id: 'toggle', label: item.enabled ? t('extensions.disable') : t('extensions.enable') },
    { id: 'reveal', label: t('extensions.revealFolder') },
    ...(item.managed
      ? [{ id: 'sep', separator: true }, { id: 'uninstall', label: t('extensions.uninstall'), danger: true }]
      : [])
  ]
})

async function selectCardMenuItem(menuItem: ContextMenuItem): Promise<void> {
  const item = cardMenu.value?.item
  cardMenu.value = null
  if (!item) return
  if (menuItem.id === 'detail') { openDetail(item.id); return }
  if (menuItem.id === 'toggle') { await setEnabled(item, !item.enabled); notifyExtensionsChanged(); return }
  if (menuItem.id === 'reveal') { void ipc.app.showItemInFolder(item.path); return }
  if (menuItem.id === 'uninstall') { await uninstallExtension(item); return }
}

async function uninstallExtension(item: ExtensionManifestSummary): Promise<void> {
  const confirmed = await ui.confirm(t('extensions.uninstallConfirm', { name: item.name }), {
    title: t('extensions.uninstall'),
    danger: true,
    confirmLabel: t('extensions.uninstall')
  })
  if (!confirmed) return
  await unwrap(ipc.extension.uninstall(item.id))
  if (editor.activeExtensionId === item.id) editor.closeExtensionDetail()
  notifyExtensionsChanged()
  await refresh()
}

function isActivated(id: string): boolean {
  return activation.value.activated.includes(id)
}

function isActiveExtension(item: ExtensionManifestSummary): boolean {
  return item.enabled && isActivated(item.id)
}

function openMarketplace(id: string): void {
  const slug = id.includes('.') ? id : id
  void unwrap(ipc.app.openExternal(`https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(slug)}`))
}

async function executeRuntimeCommand(command: string): Promise<void> {
  await runExtensionCommand(command)
}

// 输入即防抖检索 Open VSX 市场（≥2 字符）
watch(searchKeyword, (keyword) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (keyword.length < 2) {
    marketResults.value = []
    marketError.value = ''
    marketLoading.value = false
    return
  }
  marketLoading.value = true
  searchTimer = setTimeout(() => void runMarketSearch(keyword), 350)
})

async function runMarketSearch(keyword: string): Promise<void> {
  try {
    const results = await unwrap<MarketplaceExtension[]>(ipc.extension.searchMarketplace(keyword, 24))
    if (searchKeyword.value !== keyword) return // 输入已变，丢弃过期结果
    marketResults.value = results
    marketError.value = ''
  } catch (e) {
    if (searchKeyword.value !== keyword) return
    marketError.value = e instanceof Error ? e.message : String(e)
    marketResults.value = []
  } finally {
    if (searchKeyword.value === keyword) marketLoading.value = false
  }
}

async function installFromMarketplace(ext: MarketplaceExtension): Promise<void> {
  installingId.value = ext.id
  marketError.value = ''
  try {
    await unwrap(ipc.extension.installFromMarketplace(ext.namespace, ext.name))
    await refresh()
  } catch (e) {
    marketError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installingId.value = null
  }
}

async function installFromFolder(): Promise<void> {
  installing.value = true
  try {
    const path = await unwrap<string>(ipc.app.openFolderDialog())
    if (!path) return
    await unwrap(ipc.extension.installFromFolder(path))
    await refresh()
  } finally {
    installing.value = false
  }
}

async function setEnabled(item: ExtensionManifestSummary, enabled: boolean): Promise<void> {
  await unwrap(ipc.extension.setEnabled(item.id, enabled))
  item.enabled = enabled
  await refresh()
}

async function setAllEnabled(enabled: boolean): Promise<void> {
  const targets = installed.value.filter((item) => item.enabled !== enabled)
  for (const item of targets) {
    await unwrap(ipc.extension.setEnabled(item.id, enabled))
  }
  await refresh()
}

function openMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = {
    x: Math.min(rect.left, window.innerWidth - 320),
    y: rect.bottom + 6
  }
}

async function selectMenuItem(item: ContextMenuItem): Promise<void> {
  switch (item.id) {
    case 'toggle-installed':
      installedOpen.value = !installedOpen.value
      break
    case 'toggle-recommendations':
      recommendationsOpen.value = !recommendationsOpen.value
      break
    case 'toggle-commands':
      commandsOpen.value = !commandsOpen.value
      break
    case 'check-updates':
      await refresh()
      break
    case 'enable-all':
      await setAllEnabled(true)
      break
    case 'disable-all':
      await setAllEnabled(false)
      break
    case 'show-running':
      runningOnly.value = !runningOnly.value
      installedOpen.value = true
      break
    case 'install-folder':
      await installFromFolder()
      break
  }
}

function extensionSourceLabel(item: ExtensionManifestSummary): string {
  if (item.source === 'lucky-ai') return 'Lucky'
  if (item.source === 'cursor') return 'Cursor'
  return 'VS Code'
}

function matchesExtension(item: ExtensionManifestSummary, keyword: string): boolean {
  if (!keyword) return true
  const haystack = [
    item.id,
    item.name,
    item.publisher,
    item.description,
    item.version,
    item.source
  ].filter(Boolean).join('\n').toLowerCase()
  return haystack.includes(keyword)
}

// 详情页等处安装/卸载后刷新已安装列表
watch(extensionsRevision, () => { void refresh() })

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section class="extensions-panel">
    <header class="extensions-header">
      <h2>{{ t('extensions.title') }}</h2>
      <div class="header-actions">
        <button type="button" class="header-btn icon" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" :class="{ spinning: loading }" />
        </button>
        <button type="button" class="header-btn icon" @click="openMenu">
          <Ellipsis :size="17" />
        </button>
      </div>
    </header>

    <div class="extensions-toolbar">
      <label class="search-box">
        <Search :size="16" />
        <input
          v-model.trim="searchQuery"
          type="text"
          :placeholder="t('extensions.searchPlaceholder')"
        />
        <button v-if="searchQuery" type="button" class="search-tool" @click="searchQuery = ''">
          <ListX :size="15" />
        </button>
        <button type="button" class="search-tool" :class="{ active: runningOnly }" @click="runningOnly = !runningOnly">
          <ListFilter :size="15" />
        </button>
      </label>
    </div>

    <div class="extensions-content pretty-scrollbar">
      <section v-if="hasSearch" class="extensions-section">
        <button type="button" class="section-head" @click="marketplaceOpen = !marketplaceOpen">
          <ChevronRight :size="15" class="section-chevron" :class="{ open: marketplaceOpen }" />
          <h3>{{ t('extensions.marketplace') }}</h3>
          <span v-if="marketResults.length" class="section-count">{{ marketResults.length }}</span>
        </button>

        <template v-if="marketplaceOpen">
          <p v-if="marketLoading" class="empty">{{ t('extensions.marketSearching') }}</p>
          <p v-else-if="marketError" class="activation-error mx-3">{{ marketError }}</p>
          <div v-else-if="marketResults.length" class="extension-list">
            <article v-for="ext in marketResults" :key="ext.id" class="extension-card">
              <div class="extension-card-top">
                <div class="extension-icon">
                  <img v-if="ext.iconUrl" :src="ext.iconUrl" alt="" class="market-icon" @error="ext.iconUrl = undefined" />
                  <Package v-else :size="15" />
                </div>
                <div class="extension-meta">
                  <div class="extension-title-row">
                    <strong>{{ ext.displayName }}</strong>
                    <span v-if="isInstalled(ext.id)" class="source-badge">{{ t('extensions.installedBadge') }}</span>
                  </div>
                  <div class="extension-subtitle">
                    {{ ext.publisher }}<template v-if="ext.version"> · v{{ ext.version }}</template>
                    <template v-if="ext.downloadCount"> · ↓{{ ext.downloadCount.toLocaleString() }}</template>
                  </div>
                </div>
                <button
                  type="button"
                  class="toggle-btn install-btn"
                  :disabled="isInstalled(ext.id) || installingId === ext.id"
                  @click="installFromMarketplace(ext)"
                >
                  <Download v-if="!isInstalled(ext.id)" :size="13" />
                  <span>{{ isInstalled(ext.id) ? t('extensions.installedBadge') : (installingId === ext.id ? t('extensions.installing') : t('extensions.install')) }}</span>
                </button>
              </div>
              <p v-if="ext.description" class="extension-desc">{{ ext.description }}</p>
            </article>
          </div>
          <p v-else class="empty">{{ t('extensions.marketEmpty') }}</p>
        </template>
      </section>

      <section class="extensions-section">
        <button type="button" class="section-head" @click="installedOpen = !installedOpen">
          <ChevronRight :size="15" class="section-chevron" :class="{ open: installedOpen }" />
          <h3>{{ t('extensions.installed') }}</h3>
          <span class="section-count">{{ filteredInstalled.length }}</span>
        </button>

        <div v-if="installedOpen && filteredInstalled.length" class="extension-list">
          <article
            v-for="item in filteredInstalled"
            :key="item.id"
            class="extension-card is-clickable"
            :class="{ 'is-open': editor.activeExtensionId === item.id }"
            role="button"
            tabindex="0"
            @click="openDetail(item.id)"
            @keydown.enter="openDetail(item.id)"
          >
            <div class="extension-card-top">
              <div class="extension-icon"><Package :size="15" /></div>
              <div class="extension-meta">
                <div class="extension-title-row">
                  <strong>{{ item.name }}</strong>
                  <span class="source-badge">{{ extensionSourceLabel(item) }}</span>
                  <span v-if="isActiveExtension(item)" class="activation-badge">{{ t('extensions.activatedBadge') }}</span>
                  <span v-if="!item.enabled" class="disabled-badge">{{ t('extensions.disabledBadge') }}</span>
                </div>
                <div class="extension-subtitle">{{ item.publisher }} · v{{ item.version }}</div>
              </div>
              <button type="button" class="toggle-btn" @click.stop="setEnabled(item, !item.enabled)">
                {{ item.enabled ? t('extensions.disable') : t('extensions.enable') }}
              </button>
              <button
                type="button"
                class="card-menu-btn"
                :title="t('extensions.manage')"
                :aria-label="t('extensions.manage')"
                @click.stop="openCardMenu(item, $event)"
              >
                <Ellipsis :size="15" />
              </button>
            </div>

            <p v-if="item.description" class="extension-desc">{{ item.description }}</p>
            <p v-if="activationErrors.get(item.id)" class="activation-error">
              {{ t('extensions.activationFailed') }}: {{ activationErrors.get(item.id) }}
            </p>

            <div v-if="item.contributes?.languages?.length || item.contributes?.themes?.length || item.contributes?.commands?.length" class="extension-tags">
              <span v-for="lang in (item.contributes.languages ?? []).slice(0, 4)" :key="lang.id">{{ lang.id }}</span>
              <span v-for="themeItem in (item.contributes.themes ?? []).slice(0, 3)" :key="themeItem.id" class="theme-tag">{{ themeItem.label ?? themeItem.id }}</span>
              <span v-for="command in (item.contributes.commands ?? []).slice(0, 2)" :key="command.command" class="command-tag">{{ command.title ?? command.command }}</span>
            </div>
          </article>
        </div>
        <p v-else-if="installedOpen && hasSearch" class="empty">{{ t('extensions.searchEmpty') }}</p>
        <p v-else-if="installedOpen" class="empty">{{ t('extensions.noneInstalled') }}</p>
      </section>

      <section class="extensions-section">
        <button type="button" class="section-head" @click="recommendationsOpen = !recommendationsOpen">
          <ChevronRight :size="15" class="section-chevron" :class="{ open: recommendationsOpen }" />
          <h3>{{ t('code.extensionRecommendations') }}</h3>
          <span class="section-count">{{ filteredRecommendations.length }}</span>
        </button>

        <div v-if="recommendationsOpen && recommendations.unwantedRecommendations.length && !hasSearch" class="unwanted-block">
          <h4>{{ t('extensions.unwanted') }}</h4>
          <p v-for="id in recommendations.unwantedRecommendations" :key="id">{{ id }}</p>
        </div>

        <div v-if="recommendationsOpen && filteredRecommendations.length" class="extension-list compact">
          <article
            v-for="id in filteredRecommendations"
            :key="id"
            class="extension-card compact"
          >
            <div class="recommendation-main">
              <div class="recommendation-title">
                <strong>{{ id }}</strong>
                <span v-if="isInstalled(id)">{{ t('extensions.installedBadge') }}</span>
              </div>
            </div>
            <button type="button" class="market-btn" @click="openMarketplace(id)">
              <ExternalLink :size="13" />
              <span>{{ t('extensions.openMarketplace') }}</span>
            </button>
          </article>
        </div>
        <p v-else-if="recommendationsOpen && hasSearch" class="empty">{{ t('extensions.searchEmpty') }}</p>
        <p v-else-if="recommendationsOpen" class="empty">{{ t('code.noExtensionRecommendations') }}</p>
      </section>

      <section v-if="filteredRuntimeCommands.length" class="extensions-section">
        <button type="button" class="section-head" @click="commandsOpen = !commandsOpen">
          <ChevronRight :size="15" class="section-chevron" :class="{ open: commandsOpen }" />
          <h3>{{ t('extensions.runtimeCommands') }}</h3>
          <span class="section-count">{{ filteredRuntimeCommands.length }}</span>
        </button>

        <div v-if="commandsOpen" class="command-list">
          <button
            v-for="command in filteredRuntimeCommands"
            :key="command"
            type="button"
            class="command-btn"
            @click="executeRuntimeCommand(command)"
          >
            <Play :size="12" />
            <span>{{ command }}</span>
          </button>
        </div>
      </section>

      <div v-if="hasSearch && !hasVisibleContent" class="empty-state">
        <Package :size="20" />
        <p>{{ t('extensions.searchEmpty') }}</p>
      </div>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      :width="320"
      @select="selectMenuItem"
      @close="menu = null"
    />

    <ContextMenu
      v-if="cardMenu"
      :x="cardMenu.x"
      :y="cardMenu.y"
      :items="cardMenuItems"
      :width="220"
      @select="selectCardMenuItem"
      @close="cardMenu = null"
    />
  </section>
</template>

<style scoped>
.extensions-panel {
  @apply flex h-full min-h-0 flex-1 flex-col overflow-hidden;
  background: var(--codex-sidebar);
  color: var(--codex-text);
}
.extensions-header {
  @apply flex h-12 shrink-0 items-center justify-between gap-3 px-3;
}
.extensions-header h2 {
  @apply truncate text-[17px] font-bold tracking-tight;
}
.header-actions {
  @apply flex shrink-0 items-center gap-1;
}
.header-btn {
  @apply inline-flex h-7 w-7 items-center justify-center rounded-md text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text disabled:cursor-default disabled:opacity-40;
}
.header-btn[aria-expanded='true'] {
  @apply bg-codex-hover text-codex-text;
}
.extensions-toolbar {
  @apply shrink-0 px-3 pb-2;
}
.search-box {
  @apply flex h-9 items-center gap-2 rounded-md border px-2.5 text-codex-text-secondary transition-colors focus-within:text-codex-text;
  border-color: var(--codex-border);
  background: var(--codex-bg);
}
.search-box:focus-within {
  border-color: var(--codex-border-hover);
}
.search-box input {
  @apply h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium text-codex-text outline-none;
}
.search-box input::placeholder {
  color: var(--codex-muted);
}
.search-tool {
  @apply -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-codex-muted transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.search-tool.active {
  @apply bg-codex-hover text-codex-text;
}
.extensions-content {
  @apply min-h-0 flex-1 overflow-y-auto;
}
.extensions-section {
  @apply border-t;
  border-color: color-mix(in srgb, var(--codex-border) 86%, transparent);
}
.section-head {
  @apply flex h-8 w-full items-center gap-1.5 px-3 text-left transition-colors hover:bg-codex-hover;
}
.section-head h3 {
  @apply min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-wide text-codex-text-secondary;
}
.section-chevron {
  @apply shrink-0 text-codex-muted transition-transform;
}
.section-chevron.open {
  transform: rotate(90deg);
}
.section-count {
  @apply inline-flex min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 82%, transparent);
}
.extension-list {
  @apply flex flex-col;
}
.extension-card {
  @apply px-3 py-2.5 transition-colors hover:bg-codex-hover;
  border-top: 1px solid color-mix(in srgb, var(--codex-border) 58%, transparent);
  background: transparent;
}
.extension-card.compact {
  @apply flex items-center justify-between gap-2 py-2;
}
.extension-card.is-clickable {
  @apply cursor-pointer;
}
.extension-card.is-open {
  background: color-mix(in srgb, var(--codex-accent) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--codex-accent);
}
.extension-card-top {
  @apply flex items-start gap-2;
}
.extension-icon {
  @apply flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 76%, transparent);
}
.market-icon {
  @apply h-full w-full object-contain;
}
.install-btn {
  @apply gap-1 text-codex-accent;
}
.install-btn:disabled {
  @apply cursor-default text-codex-text-secondary opacity-70;
}
.extension-meta {
  @apply min-w-0 flex-1;
}
.extension-title-row {
  @apply flex min-w-0 flex-wrap items-center gap-1.5;
}
.extension-title-row strong {
  @apply min-w-0 text-[13px] font-semibold leading-4 text-codex-text;
}
.extension-subtitle {
  @apply mt-0.5 truncate text-[11px] text-codex-muted;
}
.extension-desc {
  @apply mt-1.5 overflow-hidden pl-9 text-[12px] leading-5 text-codex-text-secondary;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.source-badge,
.activation-badge,
.disabled-badge {
  @apply inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase;
}
.source-badge {
  @apply text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 88%, transparent);
}
.activation-badge {
  color: #15803d;
  background: rgb(22 163 74 / 14%);
}
.disabled-badge {
  color: #b45309;
  background: rgb(245 158 11 / 16%);
}
.activation-error {
  @apply mt-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-[11px] leading-5;
  color: #be123c;
  border-color: rgb(244 63 94 / 18%);
  background: rgb(244 63 94 / 8%);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.extension-tags {
  @apply mt-2 flex flex-wrap gap-1.5 pl-9;
}
.extension-tags span {
  @apply rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 78%, transparent);
}
.theme-tag {
  @apply normal-case;
}
.command-tag {
  @apply lowercase;
}
.toggle-btn {
  @apply inline-flex h-7 shrink-0 items-center justify-center rounded-md border px-2.5 text-[12px] font-medium text-codex-text-secondary transition-colors hover:bg-codex-bg hover:text-codex-text;
  border-color: var(--codex-border);
  background: transparent;
}
.card-menu-btn {
  @apply inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codex-muted transition-colors hover:bg-codex-bg hover:text-codex-text;
}
.recommendation-main {
  @apply min-w-0 flex-1;
}
.recommendation-title {
  @apply flex flex-wrap items-center gap-2;
}
.recommendation-title strong {
  @apply text-[13px] font-semibold text-codex-text;
}
.recommendation-title span {
  @apply rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 86%, transparent);
}
.market-btn {
  @apply inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-codex-accent transition-colors hover:bg-codex-bg;
}
.unwanted-block {
  @apply mx-3 mb-2 rounded-md border px-2.5 py-2 text-[11px] text-codex-muted;
  border-color: var(--codex-border);
  background: color-mix(in srgb, var(--codex-hover) 65%, transparent);
}
.unwanted-block h4 {
  @apply mb-1 text-[11px] font-semibold uppercase tracking-wide text-codex-text-secondary;
}
.command-list {
  @apply flex flex-col py-1;
}
.command-btn {
  @apply inline-flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.empty,
.empty-state {
  @apply text-[12px] text-codex-muted;
}
.empty {
  @apply px-3 py-2.5;
}
.empty-state {
  @apply m-3 flex flex-col items-center justify-center gap-2 rounded-lg border px-4 py-8 text-center;
  border-style: dashed;
  border-color: var(--codex-border);
}
.spinning {
  animation: ext-spin 0.9s linear infinite;
}
@keyframes ext-spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 760px) {
  .extension-card.compact,
  .extension-card-top {
    @apply flex-col items-start;
  }
  .toggle-btn,
  .market-btn {
    @apply w-full justify-center;
  }
}
</style>
