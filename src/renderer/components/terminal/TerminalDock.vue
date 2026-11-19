<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Columns2, Ellipsis, Plus, SquareTerminal, Trash2, X } from 'lucide-vue-next'
import TerminalMoreMenu from './TerminalMoreMenu.vue'
import TerminalSessionTreeGuide, { type SessionTreeRole } from './TerminalSessionTreeGuide.vue'
import TerminalTabView from './TerminalTab.vue'
import BottomPanelProblems from './BottomPanelProblems.vue'
import BottomPanelOutput from './BottomPanelOutput.vue'
import BottomPanelDebug from './BottomPanelDebug.vue'
import BottomPanelPorts from './BottomPanelPorts.vue'
import ResizeHandle from '../layout/ResizeHandle.vue'
import { listDiagnostics, subscribeDiagnostics } from '../../services/lsp-client.service.js'
import { useTerminalStore, type BottomPanelView, type TerminalTab } from '../../stores/terminal.store.js'

const { t } = useI18n()
withDefaults(defineProps<{ location?: 'bottom' | 'right' }>(), { location: 'bottom' })
const terminal = useTerminalStore()
const diagnosticsSnapshot = ref(listDiagnostics())
const splitContainerRef = ref<HTMLElement | null>(null)
let unsubscribeDiagnostics: (() => void) | null = null
let splitDragIndex: number | null = null
let splitDragStartX = 0
const splitDividerDragging = ref(false)

const heightStyle = computed(() => ({ height: `${terminal.panelHeight}px` }))
const sessionsWidthStyle = computed(() => ({ width: `${terminal.sessionsSidebarWidth}px` }))

const splitPaneTabs = computed((): TerminalTab[] => {
  return terminal
    .resolveSplitPanes()
    .map((paneId) => terminal.tabs.find((tab) => tab.id === paneId))
    .filter((tab): tab is TerminalTab => !!tab)
})

function splitPaneStyle(index: number): { flex: string } {
  const sizes = terminal.splitPaneSizes
  const size = sizes[index] ?? 1 / Math.max(splitPaneTabs.value.length, 1)
  return { flex: `${size} 1 0%` }
}

function handleSplitResize(index: number, delta: number): void {
  terminal.resizeSplitPane(index, delta, splitContainerRef.value?.clientWidth ?? 0)
}

function onSplitDividerMouseDown(index: number, e: MouseEvent): void {
  splitDragIndex = index
  splitDragStartX = e.clientX
  splitDividerDragging.value = true
  document.addEventListener('mousemove', onSplitDividerMouseMove)
  document.addEventListener('mouseup', onSplitDividerMouseUp)
}

function onSplitDividerMouseMove(e: MouseEvent): void {
  if (splitDragIndex === null) return
  const delta = e.clientX - splitDragStartX
  splitDragStartX = e.clientX
  handleSplitResize(splitDragIndex, delta)
}

function onSplitDividerMouseUp(): void {
  splitDragIndex = null
  splitDividerDragging.value = false
  document.removeEventListener('mousemove', onSplitDividerMouseMove)
  document.removeEventListener('mouseup', onSplitDividerMouseUp)
}

const panelViews: Array<{ id: BottomPanelView; labelKey: string }> = [
  { id: 'problems', labelKey: 'bottomPanel.problems' },
  { id: 'output', labelKey: 'bottomPanel.output' },
  { id: 'debug', labelKey: 'bottomPanel.debugConsole' },
  { id: 'terminal', labelKey: 'bottomPanel.terminal' },
  { id: 'ports', labelKey: 'bottomPanel.ports' }
]

const problemCount = computed(() =>
  diagnosticsSnapshot.value.reduce((count, payload) => count + payload.diagnostics.length, 0)
)

const showSessionsSidebar = computed(() => terminal.tabs.length > 1)
const singleActiveTab = computed(() =>
  terminal.tabs.length === 1 ? terminal.tabs[0] ?? null : null
)

interface SessionListItem {
  tab: TerminalTab
  treeRole: SessionTreeRole
}

function treeRoleForIndex(index: number, count: number): SessionTreeRole {
  if (count <= 1) return 'only'
  if (index === 0) return 'first'
  if (index === count - 1) return 'last'
  return 'middle'
}

const sessionListItems = computed((): SessionListItem[] => {
  const panes = terminal.resolveSplitPanes()
  if (panes.length < 2) {
    return terminal.tabs.map((tab) => ({ tab, treeRole: 'none' }))
  }

  const paneSet = new Set(panes)
  const paneTabs = panes
    .map((id) => terminal.tabs.find((tab) => tab.id === id))
    .filter((tab): tab is TerminalTab => !!tab)
  const [firstPaneId] = panes
  const items: SessionListItem[] = []
  let groupInserted = false

  for (const tab of terminal.tabs) {
    if (paneSet.has(tab.id)) {
      if (tab.id === firstPaneId && !groupInserted) {
        paneTabs.forEach((paneTab, index) => {
          items.push({ tab: paneTab, treeRole: treeRoleForIndex(index, paneTabs.length) })
        })
        groupInserted = true
      }
      continue
    }
    items.push({ tab, treeRole: 'none' })
  }

  return items
})

onMounted(() => {
  unsubscribeDiagnostics = subscribeDiagnostics((payloads) => {
    diagnosticsSnapshot.value = payloads
  })
})

onUnmounted(() => {
  unsubscribeDiagnostics?.()
  onSplitDividerMouseUp()
})

async function handleAddTab(): Promise<void> {
  terminal.setActiveView('terminal')
  await terminal.addTab()
}

async function handleCloseTab(tabId: string, e: MouseEvent): Promise<void> {
  e.stopPropagation()
  await terminal.closeTab(tabId)
}

async function handleSplitTab(tabId: string, e: MouseEvent): Promise<void> {
  e.stopPropagation()
  await terminal.splitTab(tabId)
}

function focusPane(tabId: string): void {
  terminal.selectTab(tabId)
}

async function handleClosePanel(): Promise<void> {
  await terminal.closePanel()
}

function selectView(view: BottomPanelView): void {
  terminal.setActiveView(view)
}
</script>

<template>
  <section class="bottom-panel" :class="`dock-${location}`" :style="location === 'bottom' ? heightStyle : undefined">
    <ResizeHandle v-if="location === 'bottom'" direction="vertical" class="panel-resize" @resize="terminal.resizePanel" />

    <header class="panel-header">
      <nav class="panel-views">
        <button
          v-for="view in panelViews"
          :key="view.id"
          type="button"
          class="panel-view"
          :class="{ 'is-active': terminal.activeView === view.id }"
          @click="selectView(view.id)"
        >
          <span>{{ t(view.labelKey) }}</span>
          <span v-if="view.id === 'problems' && problemCount" class="view-badge">{{ problemCount }}</span>
        </button>
      </nav>

      <div class="panel-actions">
        <template v-if="terminal.activeView === 'terminal'">
          <button
            type="button"
            class="action-btn"
            :title="t('terminal.newTab')"
            @click="handleAddTab"
          >
            <Plus :size="15" :stroke-width="2" />
          </button>
          <template v-if="singleActiveTab">
            <button
              type="button"
              class="action-btn"
              :title="t('terminal.splitTab')"
              @click="handleSplitTab(singleActiveTab.id, $event)"
            >
              <Columns2 :size="15" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="action-btn"
              :title="t('terminal.killTab')"
              @click="handleCloseTab(singleActiveTab.id, $event)"
            >
              <Trash2 :size="15" :stroke-width="2" />
            </button>
          </template>
        </template>
        <TerminalMoreMenu>
          <Ellipsis :size="15" :stroke-width="2" />
        </TerminalMoreMenu>
        <button
          type="button"
          class="action-btn"
          :title="t('terminal.closePanel')"
          @click="handleClosePanel"
        >
          <X :size="15" :stroke-width="2" />
        </button>
      </div>
    </header>

    <div class="panel-body">
      <BottomPanelProblems v-show="terminal.activeView === 'problems'" />
      <BottomPanelOutput v-show="terminal.activeView === 'output'" />
      <BottomPanelDebug v-show="terminal.activeView === 'debug'" />
      <BottomPanelPorts v-show="terminal.activeView === 'ports'" />

      <div v-show="terminal.activeView === 'terminal'" class="terminal-layout">
        <div
          ref="splitContainerRef"
          class="terminal-main"
          :class="{ 'is-split': splitPaneTabs.length >= 2 }"
        >
          <template v-if="splitPaneTabs.length >= 2">
            <template v-for="(tab, index) in splitPaneTabs" :key="tab.id">
              <div
                class="split-pane"
                :style="splitPaneStyle(index)"
                @mousedown="focusPane(tab.id)"
              >
                <TerminalTabView
                  :session-id="tab.sessionId"
                  :visible="true"
                  :focused="terminal.isTabFocused(tab.id)"
                />
              </div>
              <div
                v-if="index < splitPaneTabs.length - 1"
                class="split-divider"
                :class="{ 'is-dragging': splitDividerDragging }"
                @mousedown.prevent="onSplitDividerMouseDown(index, $event)"
              />
            </template>
          </template>

          <template v-else>
            <TerminalTabView
              v-for="tab in terminal.tabs"
              :key="tab.sessionId"
              :session-id="tab.sessionId"
              :visible="terminal.isTabVisible(tab.id)"
              :focused="terminal.isTabFocused(tab.id)"
            />
            <p v-if="!terminal.tabs.length" class="panel-empty">{{ t('bottomPanel.noTerminal') }}</p>
          </template>
        </div>

        <ResizeHandle
          v-if="showSessionsSidebar"
          direction="horizontal"
          class="sessions-resize"
          @resize="terminal.resizeSessionsSidebar"
        />

        <aside
          v-if="showSessionsSidebar"
          class="terminal-sessions"
          :style="sessionsWidthStyle"
        >
          <div
            v-for="{ tab, treeRole } in sessionListItems"
            :key="tab.id"
            class="session-item"
            :class="{ 'is-active': tab.id === terminal.activeTabId, 'has-tree': treeRole !== 'none' }"
          >
            <button type="button" class="session-select" @click="terminal.selectTab(tab.id)">
              <TerminalSessionTreeGuide :role="treeRole" />
              <SquareTerminal :size="14" :stroke-width="2" class="session-icon" />
              <span class="session-label">{{ tab.title }}</span>
            </button>
            <span class="session-actions">
              <button
                type="button"
                class="session-action"
                :title="t('terminal.splitTab')"
                @click="handleSplitTab(tab.id, $event)"
              >
                <Columns2 :size="14" :stroke-width="2" />
              </button>
              <button
                type="button"
                class="session-action"
                :title="t('terminal.killTab')"
                @click="handleCloseTab(tab.id, $event)"
              >
                <Trash2 :size="14" :stroke-width="2" />
              </button>
            </span>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bottom-panel {
  --panel-bg: var(--codex-bg);
  --panel-tab-active-bg: color-mix(in srgb, var(--codex-text) 6%, var(--codex-bg));
  --term-chrome-icon: color-mix(in srgb, var(--codex-text) 78%, transparent);
  --term-chrome-icon-hover: var(--codex-text);
  --term-chrome-label: var(--codex-text-secondary);

  @apply shrink-0 flex min-h-0 flex-col overflow-hidden border-t border-codex-border bg-codex-bg;
}
.bottom-panel.dock-right {
  width: min(420px, 42vw);
  height: 100%;
  border-top-width: 0;
  border-left: 1px solid var(--codex-border);
}

.panel-resize {
  @apply h-[3px] shrink-0 cursor-row-resize;
  background: transparent;
}
.panel-resize:hover {
  background-color: color-mix(in srgb, var(--codex-accent) 35%, transparent);
}

.panel-header {
  @apply flex h-8 shrink-0 items-center gap-2 px-2;
  background: var(--panel-bg);
}

.panel-views {
  @apply flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto;
  scrollbar-width: none;
}
.panel-views::-webkit-scrollbar {
  display: none;
}

.panel-view {
  @apply flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide
         transition-colors;
  color: var(--term-chrome-label);
}
.panel-view:hover {
  color: var(--term-chrome-icon-hover);
}
.panel-view.is-active {
  background: var(--panel-tab-active-bg);
  color: var(--codex-text);
}

.view-badge {
  @apply rounded-full px-1.5 py-0 text-[10px] font-semibold;
  background: color-mix(in srgb, var(--codex-accent) 16%, transparent);
  color: var(--codex-accent);
}

.panel-actions {
  @apply ml-auto flex shrink-0 items-center gap-0.5;
}

.action-btn {
  @apply flex h-6 w-6 items-center justify-center rounded transition-colors
         hover:bg-codex-hover;
  color: var(--term-chrome-icon);
}
.action-btn:hover {
  color: var(--term-chrome-icon-hover);
}

.panel-body {
  @apply relative min-h-0 flex-1;
  background: var(--panel-bg);
}

.terminal-layout {
  @apply flex h-full min-h-0;
}

.terminal-main {
  @apply relative min-w-0 flex-1;
}
.terminal-main.is-split {
  @apply flex min-h-0;
}

.split-pane {
  @apply relative min-h-0 min-w-0;
}

.split-divider {
  @apply relative shrink-0;
  width: 0;
  z-index: 2;
}
.split-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 9px;
  cursor: col-resize;
}
.split-divider::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--codex-border) 92%, transparent);
  pointer-events: none;
  transition: background-color 0.12s ease;
}
.split-divider:hover::after,
.split-divider.is-dragging::after {
  background: color-mix(in srgb, var(--codex-accent) 35%, var(--codex-border));
}

.sessions-resize {
  @apply w-[3px] shrink-0 cursor-col-resize;
  background: transparent;
}
.sessions-resize:hover {
  background-color: color-mix(in srgb, var(--codex-accent) 35%, transparent);
}

.terminal-sessions {
  @apply flex shrink-0 flex-col overflow-y-auto border-l border-codex-border py-1;
  background: color-mix(in srgb, var(--codex-sidebar) 35%, var(--codex-bg));
}

.session-item {
  @apply flex w-full items-center gap-1 px-2 py-0 text-[12px] font-medium transition-colors;
  color: var(--term-chrome-label);
}
.session-item.is-active {
  @apply text-codex-text;
  background: color-mix(in srgb, var(--codex-text) 6%, var(--codex-bg));
}
.session-item:hover {
  background: color-mix(in srgb, var(--codex-text) 4%, var(--codex-bg));
}
.session-item.is-active:hover {
  background: color-mix(in srgb, var(--codex-text) 6%, var(--codex-bg));
}

.session-actions {
  @apply ml-auto flex shrink-0 items-center gap-0.5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.session-item:hover .session-actions {
  opacity: 1;
  pointer-events: auto;
}

.session-select {
  @apply flex min-w-0 flex-1 items-center gap-0.5 rounded py-1 text-left transition-colors;
}
.session-item.has-tree .session-select {
  @apply gap-0;
}
.session-item.has-tree .session-icon {
  @apply -ml-0.5;
}
.session-item.is-active .session-select {
  @apply text-codex-text;
}

.session-action {
  @apply flex h-5 w-5 items-center justify-center rounded transition-colors
         hover:bg-codex-bg;
  color: var(--term-chrome-icon);
}
.session-action:hover {
  color: var(--term-chrome-icon-hover);
}

.session-icon {
  @apply shrink-0;
  color: var(--term-chrome-icon);
}
.session-item.is-active .session-icon {
  color: var(--term-chrome-icon-hover);
}

.session-label {
  @apply min-w-0 flex-1 truncate;
}

.panel-empty {
  @apply flex h-full items-center justify-center px-4 text-[12px] text-codex-muted;
}
</style>
