<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  Search,
  SlidersHorizontal,
  UserCircle,
  Sun,
  Hexagon,
  Sparkles,
  Keyboard,
  Scan,
  Link2,
  Info,
  ShieldCheck,
  Brain,
  BarChart3
} from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useThemeStore } from '../../stores/theme.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import AboutPanel from './panels/AboutPanel.vue'
import GeneralPanel from './panels/GeneralPanel.vue'
import AppearancePanel from './panels/AppearancePanel.vue'
import PersonalizationPanel from './panels/PersonalizationPanel.vue'
import KeyboardShortcutsPanel from './panels/KeyboardShortcutsPanel.vue'
import PlaceholderPanel from './panels/PlaceholderPanel.vue'
import ConfigurationPanel from './panels/ConfigurationPanel.vue'
import McpServersPanel from './panels/McpServersPanel.vue'
import SecurityPanel from './panels/SecurityPanel.vue'
import UsagePanel from './panels/UsagePanel.vue'
import AgentRuntimeView from '../agent/AgentRuntimeView.vue'

type SettingsTabId =
  | 'general'
  | 'security'
  | 'profile'
  | 'appearance'
  | 'configuration'
  | 'personalization'
  | 'keyboard-shortcuts'
  | 'brain'
  | 'app-snapshot'
  | 'mcp-servers'
  | 'usage'
  | 'about'

interface NavItem {
  id: SettingsTabId
  labelKey: string
  icon: Component
  group: 'personal' | 'integration'
}

const { t } = useI18n()
const ICON_STROKE = 2

const NAV_ITEMS: NavItem[] = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: SlidersHorizontal, group: 'personal' },
  { id: 'security', labelKey: 'settings.tabs.security', icon: ShieldCheck, group: 'personal' },
  { id: 'profile', labelKey: 'settings.tabs.profile', icon: UserCircle, group: 'personal' },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', icon: Sun, group: 'personal' },
  { id: 'configuration', labelKey: 'settings.tabs.configuration', icon: Hexagon, group: 'personal' },
  { id: 'personalization', labelKey: 'settings.tabs.personalization', icon: Sparkles, group: 'personal' },
  { id: 'keyboard-shortcuts', labelKey: 'settings.tabs.keyboardShortcuts', icon: Keyboard, group: 'personal' },
  { id: 'brain', labelKey: 'settings.tabs.brain', icon: Brain, group: 'integration' },
  { id: 'app-snapshot', labelKey: 'settings.tabs.appSnapshot', icon: Scan, group: 'integration' },
  { id: 'mcp-servers', labelKey: 'settings.tabs.mcpServers', icon: Link2, group: 'integration' },
  { id: 'usage', labelKey: 'settings.tabs.usage', icon: BarChart3, group: 'integration' },
  { id: 'about', labelKey: 'settings.tabs.about', icon: Info, group: 'integration' }
]

const PLACEHOLDER_META: Partial<
  Record<SettingsTabId, { titleKey: string; descriptionKey?: string }>
> = {
  profile: { titleKey: 'settings.placeholders.profileTitle', descriptionKey: 'settings.placeholders.profileDesc' },
  appearance: { titleKey: 'settings.placeholders.appearanceTitle', descriptionKey: 'settings.placeholders.appearanceDesc' },
  'app-snapshot': { titleKey: 'settings.placeholders.appSnapshotTitle', descriptionKey: 'settings.placeholders.appSnapshotDesc' }
}

const settings = useSettingsStore()
const theme = useThemeStore()
const ui = useUiStore()
const activeTab = ref<SettingsTabId>('general')
const searchQuery = ref('')

function navLabel(item: NavItem): string {
  return t(item.labelKey)
}

const filteredPersonal = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return NAV_ITEMS.filter((item) => {
    if (item.group !== 'personal') return false
    if (!q) return true
    return navLabel(item).toLowerCase().includes(q)
  })
})

const filteredIntegration = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return NAV_ITEMS.filter((item) => {
    if (item.group !== 'integration') return false
    if (!q) return true
    return navLabel(item).toLowerCase().includes(q)
  })
})

const activeLabel = computed(() => {
  const item = NAV_ITEMS.find((entry) => entry.id === activeTab.value)
  return item ? navLabel(item) : ''
})

async function closeSettings(): Promise<void> {
  if (ui.appDialog) {
    ui.resolveDialog({ confirmed: false })
  }
  await settings.flushConfigurationDraft()
  await settings.save()
  await theme.save()
  settings.showSettings = false
}

function selectTab(id: SettingsTabId): void {
  activeTab.value = id
}
</script>

<template>
  <div class="settings-root">
    <aside class="settings-sidebar">
      <div class="sidebar-top drag-region" />

      <div class="sidebar-header no-drag">
        <button type="button" class="back-btn" @click="closeSettings">
          <ArrowLeft :size="15" :stroke-width="ICON_STROKE" />
          <span>{{ t('settings.backToApp') }}</span>
        </button>

        <div class="search-wrap">
          <Search :size="14" :stroke-width="ICON_STROKE" class="search-icon" />
          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            :placeholder="t('settings.searchPlaceholder')"
          />
        </div>
      </div>

      <nav class="settings-nav pretty-scrollbar no-drag">
        <template v-if="filteredPersonal.length">
          <div class="nav-group-label">{{ t('settings.groups.personal') }}</div>
          <button
            v-for="item in filteredPersonal"
            :key="item.id"
            type="button"
            class="nav-item"
            :class="{ 'is-active': activeTab === item.id }"
            @click="selectTab(item.id)"
          >
            <component :is="item.icon" :size="16" :stroke-width="ICON_STROKE" class="nav-icon" />
            <span class="nav-label">{{ navLabel(item) }}</span>
          </button>
        </template>

        <template v-if="filteredIntegration.length">
          <div class="nav-group-label">{{ t('settings.groups.integration') }}</div>
          <button
            v-for="item in filteredIntegration"
            :key="item.id"
            type="button"
            class="nav-item"
            :class="{ 'is-active': activeTab === item.id }"
            @click="selectTab(item.id)"
          >
            <component :is="item.icon" :size="16" :stroke-width="ICON_STROKE" class="nav-icon" />
            <span class="nav-label">{{ navLabel(item) }}</span>
          </button>
        </template>
      </nav>
    </aside>

    <div class="settings-content-col">
      <div class="content-top drag-region" />
      <main class="settings-main pretty-scrollbar no-drag">
        <div class="settings-main-inner">
          <GeneralPanel v-if="activeTab === 'general'" />
          <SecurityPanel v-else-if="activeTab === 'security'" />
          <AppearancePanel v-else-if="activeTab === 'appearance'" />
          <PersonalizationPanel v-else-if="activeTab === 'personalization'" />
          <KeyboardShortcutsPanel v-else-if="activeTab === 'keyboard-shortcuts'" />
          <ConfigurationPanel v-else-if="activeTab === 'configuration'" />
          <AgentRuntimeView v-else-if="activeTab === 'brain'" />
          <McpServersPanel v-else-if="activeTab === 'mcp-servers'" />
          <UsagePanel v-else-if="activeTab === 'usage'" />
          <AboutPanel v-else-if="activeTab === 'about'" />
          <PlaceholderPanel
            v-else
            :kind="activeTab"
            :title="PLACEHOLDER_META[activeTab] ? t(PLACEHOLDER_META[activeTab]!.titleKey) : activeLabel"
            :description="PLACEHOLDER_META[activeTab]?.descriptionKey ? t(PLACEHOLDER_META[activeTab]!.descriptionKey!) : undefined"
          />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-root {
  @apply flex h-screen w-screen overflow-hidden bg-codex-bg text-codex-text;
}

.settings-sidebar {
  @apply w-[280px] shrink-0 flex flex-col h-full bg-codex-sidebar border-r border-codex-border;
}

.sidebar-top {
  @apply h-[38px] shrink-0;
}

.sidebar-header {
  @apply shrink-0 px-3 pb-3;
}

.back-btn {
  @apply flex items-center gap-1.5 px-2 py-1.5 mb-2.5 rounded-md text-[13px]
         hover:bg-codex-hover transition-colors w-full text-left text-codex-text-secondary;
}

.search-wrap {
  @apply relative;
}

.search-icon {
  @apply absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-codex-muted;
}

.search-input {
  @apply w-full h-[34px] pl-9 pr-3 text-[13px] rounded-[10px] border border-codex-border
         bg-codex-bg text-codex-text outline-none focus:border-codex-accent
         placeholder:text-codex-muted;
}

.search-input:focus {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-accent) 15%, transparent);
}

.settings-nav {
  @apply flex-1 min-h-0 overflow-y-auto px-3 pb-6;
}

.nav-group-label {
  @apply px-2 pt-3 pb-1 text-[12px] font-medium text-codex-muted;
}

.nav-group-label:first-child {
  @apply pt-1;
}

.nav-item {
  @apply flex items-center gap-2.5 px-2 py-[7px] rounded-[8px] text-[13px]
         hover:bg-codex-sidebar-hover transition-colors w-full text-left text-codex-text;
}

.nav-item.is-active {
  @apply bg-codex-sidebar-hover font-medium text-codex-text;
}

.nav-icon {
  @apply shrink-0 text-codex-text-secondary;
}

.nav-item.is-active .nav-icon {
  @apply text-codex-text;
}

.nav-label {
  @apply truncate;
}

.settings-content-col {
  @apply flex-1 flex flex-col min-w-0 min-h-0 bg-codex-bg;
}

.content-top {
  @apply h-[38px] shrink-0 border-b border-transparent;
}

.settings-main {
  @apply flex-1 overflow-y-auto min-h-0;
}

.settings-main-inner {
  @apply w-full max-w-[760px] mx-auto px-8 py-8;
}

.settings-main-inner :deep(.settings-panel) {
  @apply w-full;
}

.settings-main-inner :deep(.panel-title) {
  @apply mb-8 text-[28px] font-semibold tracking-tight text-codex-text;
}

.settings-main-inner :deep(.panel-heading),
.settings-main-inner :deep(.panel-header),
.settings-main-inner :deep(.usage-head) {
  @apply mb-8 flex items-start justify-between gap-4;
}

.settings-main-inner :deep(.panel-heading .panel-title),
.settings-main-inner :deep(.panel-header .panel-title),
.settings-main-inner :deep(.usage-head .panel-title) {
  @apply mb-0;
}

.settings-main-inner :deep(.panel-desc) {
  @apply max-w-[620px] text-[13px] leading-relaxed text-codex-muted;
}

.settings-main-inner :deep(.settings-section) {
  @apply mb-10;
}

.settings-main-inner :deep(.settings-section:last-child) {
  @apply mb-0;
}

.settings-main-inner :deep(.section-title) {
  @apply mb-1 text-[15px] font-semibold tracking-normal text-codex-text;
}

.settings-main-inner :deep(.section-desc) {
  @apply mb-4 max-w-[620px] text-[13px] leading-relaxed text-codex-muted;
}

.settings-main-inner :deep(.settings-group) {
  @apply overflow-hidden rounded-xl border border-codex-border bg-codex-bg;
}

.settings-main-inner :deep(.settings-row) {
  @apply flex min-h-[58px] items-center justify-between gap-6 px-4 py-3.5;
}

.settings-main-inner :deep(.settings-row + .settings-row) {
  @apply border-t border-codex-border;
}

.settings-main-inner :deep(.row-text) {
  @apply min-w-0 flex-1;
}

.settings-main-inner :deep(.row-title) {
  @apply text-[13px] font-semibold leading-5 text-codex-text;
}

.settings-main-inner :deep(.row-desc) {
  @apply mt-0.5 max-w-[460px] text-[12px] leading-relaxed text-codex-muted;
}

.settings-main-inner :deep(.field-label) {
  @apply mb-1.5 block text-[12px] font-semibold text-codex-text-secondary;
}

.settings-main-inner :deep(.settings-input),
.settings-main-inner :deep(.field-input),
.settings-main-inner :deep(.search-input),
.settings-main-inner :deep(.font-input),
.settings-main-inner :deep(.number-input),
.settings-main-inner :deep(.compact-select),
.settings-main-inner :deep(.settings-select),
.settings-main-inner :deep(.preset-select),
.settings-main-inner :deep(.policy-select),
.settings-main-inner :deep(.kv-input),
.settings-main-inner :deep(.image-input) {
  @apply h-9 rounded-[10px] border border-codex-border bg-codex-hover px-3 text-[13px]
         text-codex-text outline-none transition-colors placeholder:text-codex-muted;
}

.settings-main-inner :deep(.settings-input:focus),
.settings-main-inner :deep(.field-input:focus),
.settings-main-inner :deep(.search-input:focus),
.settings-main-inner :deep(.font-input:focus),
.settings-main-inner :deep(.number-input:focus),
.settings-main-inner :deep(.compact-select:focus),
.settings-main-inner :deep(.settings-select:focus),
.settings-main-inner :deep(.preset-select:focus),
.settings-main-inner :deep(.policy-select:focus),
.settings-main-inner :deep(.kv-input:focus),
.settings-main-inner :deep(.image-input:focus) {
  @apply border-codex-accent bg-codex-bg;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-accent) 12%, transparent);
}

.settings-main-inner :deep(textarea.field-input),
.settings-main-inner :deep(.textarea-field),
.settings-main-inner :deep(.instructions-textarea),
.settings-main-inner :deep(.manual-memory textarea) {
  @apply min-h-[92px] rounded-[10px] border border-codex-border bg-codex-hover px-3 py-2.5 text-[13px]
         leading-relaxed text-codex-text outline-none transition-colors placeholder:text-codex-muted;
}

.settings-main-inner :deep(textarea.field-input:focus),
.settings-main-inner :deep(.textarea-field:focus),
.settings-main-inner :deep(.instructions-textarea:focus),
.settings-main-inner :deep(.manual-memory textarea:focus) {
  @apply border-codex-accent bg-codex-bg;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-accent) 12%, transparent);
}

.settings-main-inner :deep(.primary-btn),
.settings-main-inner :deep(.save-btn) {
  @apply inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-codex-text px-3.5
         text-[13px] font-semibold text-codex-bg transition-opacity hover:opacity-90
         disabled:cursor-not-allowed disabled:opacity-45;
}

.settings-main-inner :deep(.secondary-btn),
.settings-main-inner :deep(.ghost-btn),
.settings-main-inner :deep(.preset-btn),
.settings-main-inner :deep(.add-btn),
.settings-main-inner :deep(.empty-add-btn),
.settings-main-inner :deep(.action-btn),
.settings-main-inner :deep(.add-row-btn),
.settings-main-inner :deep(.kv-add),
.settings-main-inner :deep(.recording-btn),
.settings-main-inner :deep(.manual-memory button),
.settings-main-inner :deep(.memory-actions button),
.settings-main-inner :deep(.refresh-btn) {
  @apply inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-codex-border bg-codex-bg
         px-3 text-[13px] font-medium text-codex-text-secondary transition-colors
         hover:border-codex-border-hover hover:bg-codex-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-45;
}

.settings-main-inner :deep(.icon-btn) {
  @apply inline-flex h-8 w-8 items-center justify-center rounded-[9px] text-codex-text-secondary
         transition-colors hover:bg-codex-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-35;
}

.settings-main-inner :deep(.memory-actions button.danger),
.settings-main-inner :deep(.action-btn.danger),
.settings-main-inner :deep(.icon-btn.danger),
.settings-main-inner :deep(.danger) {
  @apply text-red-500 hover:bg-red-50 hover:text-red-600;
}

.settings-main-inner :deep(.memory-status-tabs),
.settings-main-inner :deep(.model-vision-group),
.settings-main-inner :deep(.select-inner) {
  @apply rounded-[10px] border border-codex-border bg-codex-hover;
}

.settings-main-inner :deep(.memory-status-tabs button),
.settings-main-inner :deep(.model-vision-option) {
  @apply rounded-md text-[12px] font-medium text-codex-text-secondary transition-colors;
}

.settings-main-inner :deep(.memory-status-tabs button.active),
.settings-main-inner :deep(.model-vision-option.is-selected) {
  @apply bg-codex-bg text-codex-text shadow-sm;
}

.settings-main-inner :deep(.mini-action) {
  @apply inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium
         text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-40;
}

.settings-main-inner :deep(.usage-card),
.settings-main-inner :deep(.status-tile),
.settings-main-inner :deep(.empty-card),
.settings-main-inner :deep(.mode-card),
.settings-main-inner :deep(.dock-card),
.settings-main-inner :deep(.provider-card),
.settings-main-inner :deep(.policy-card),
.settings-main-inner :deep(.memory-card) {
  @apply rounded-xl border border-codex-border bg-codex-bg;
}

.settings-main-inner :deep(.usage-table),
.settings-main-inner :deep(.shortcuts-table),
.settings-main-inner :deep(.tool-table) {
  @apply overflow-hidden rounded-xl border border-codex-border bg-codex-bg;
}

.settings-main-inner :deep(.model-table) {
  @apply overflow-x-auto overflow-y-hidden rounded-xl border border-codex-border bg-codex-bg;
}

.settings-main-inner :deep(.test-badge),
.settings-main-inner :deep(.test-status),
.settings-main-inner :deep(.pill) {
  @apply inline-flex min-h-6 items-center rounded-md bg-codex-hover px-2 text-[12px] font-medium text-codex-text-secondary;
}

.settings-main-inner :deep(.test-badge.is-ok),
.settings-main-inner :deep(.test-status.is-ok) {
  @apply bg-emerald-50 text-emerald-700;
}

.settings-main-inner :deep(.test-badge.is-error),
.settings-main-inner :deep(.test-status.is-error) {
  @apply bg-red-50 text-red-600;
}

.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
</style>
