<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Bell,
  BookOpen,
  Bug,
  CalendarDays,
  ChevronDown,
  GitPullRequest,
  MessageCircle,
  Pencil,
  Play,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-vue-next'
import { useScheduledTaskStore } from '../../stores/scheduled-task.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { formatMessageTimestamp } from '../../utils/time.js'
import type { ScheduledTask, ScheduledTaskTemplate } from '../../../shared/types/scheduled-task.js'
import ScheduledTaskEditDrawer from './ScheduledTaskEditDrawer.vue'
import ScheduledTaskCreateDialog from './ScheduledTaskCreateDialog.vue'

/**
 * 已安排任务列表页：任务/模板两个标签 + 创建入口。
 * 编辑抽屉与手动创建对话框拆在 ScheduledTaskEditDrawer / ScheduledTaskCreateDialog。
 */
const { t } = useI18n()
const tasks = useScheduledTaskStore()
const ui = useUiStore()
const chat = useChatStore()
const projects = useProjectStore()

const createMenuOpen = ref(false)
const createFormOpen = ref(false)
const createMenuRef = ref<HTMLElement | null>(null)
const drawerTask = ref<ScheduledTask | null>(null)
const drawerReadonly = ref(true)
const running = ref<string | null>(null)

const activeTasks = computed(() =>
  tasks.currentTasks.filter((task) => task.status === 'active' && task.pendingRunAt == null)
)
const pausedTasks = computed(() =>
  tasks.currentTasks.filter((task) => task.status === 'paused' && task.pendingRunAt == null)
)
const hasCurrentTasks = computed(() => tasks.currentTasks.length > 0)
const systemTemplates = computed(() => tasks.templates.filter((item) => item.category === 'system'))
const projectTemplates = computed(() => tasks.templates.filter((item) => item.category === 'project'))
const pendingTasks = computed(() => tasks.pendingTasks)

onMounted(async () => {
  await Promise.all([tasks.load(), tasks.loadTemplates(), projects.load()])
  document.addEventListener('click', onCreateMenuDocClick)
  if (tasks.focusTaskId) focusTask(tasks.focusTaskId)
})

// 原生通知点击后定位到对应任务并打开编辑抽屉。
watch(
  () => tasks.focusTaskId,
  (id) => {
    if (id) focusTask(id)
  }
)

function focusTask(id: string): void {
  const target = tasks.currentTasks.find((task) => task.id === id)
  if (target) openTaskDetails(target)
  tasks.focusTaskId = null
}

onUnmounted(() => {
  document.removeEventListener('click', onCreateMenuDocClick)
})

function onCreateMenuDocClick(event: MouseEvent): void {
  if (!createMenuRef.value?.contains(event.target as Node)) createMenuOpen.value = false
}

function toggleCreateMenu(event: MouseEvent): void {
  event.stopPropagation()
  createMenuOpen.value = !createMenuOpen.value
}

function openChatCreate(): void {
  createMenuOpen.value = false
  if (!chat.input.trim()) chat.input = t('scheduledTasks.createPrompt')
  ui.currentView = 'home'
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.composer-rich-input, .composer-input')?.focus()
  })
}

function openManualCreate(): void {
  createMenuOpen.value = false
  createFormOpen.value = true
}

async function createFromTemplate(template: ScheduledTaskTemplate): Promise<void> {
  await tasks.createFromTemplate(template.id)
}

async function runTask(task: ScheduledTask): Promise<void> {
  if (running.value) return
  running.value = task.id
  try {
    await tasks.runScheduledTask(task, { trigger: 'manual' })
  } finally {
    running.value = null
  }
}

async function dismissPending(task: ScheduledTask): Promise<void> {
  await tasks.dismissPending(task.id)
}

function openTaskDetails(task: ScheduledTask): void {
  drawerReadonly.value = true
  drawerTask.value = task
}

function openTaskEdit(task: ScheduledTask): void {
  drawerReadonly.value = false
  drawerTask.value = task
}

async function deleteTask(task: ScheduledTask): Promise<void> {
  if (!window.confirm(t('scheduledTasks.deleteConfirm', { title: task.title }))) return
  await tasks.archive(task.id)
  if (drawerTask.value?.id === task.id) drawerTask.value = null
}

function templateIcon(template: ScheduledTaskTemplate) {
  return {
    bell: Bell,
    book: BookOpen,
    bug: Bug,
    calendar: CalendarDays,
    git: GitPullRequest,
    search: Search,
    sparkles: Sparkles
  }[template.icon]
}

function formatTimestamp(value?: number | null): string {
  if (!value) return t('scheduledTasks.never')
  return formatMessageTimestamp(value)
}

function formatScheduleText(task: ScheduledTask): string {
  return task.scheduleText || t(`scheduledTasks.cadence.${task.cadence}`)
}
</script>

<template>
  <section class="scheduled-page">
    <div class="scheduled-topbar">
      <div class="page-tabs">
        <button
          type="button"
          class="page-tab"
          :class="{ active: tasks.activeTab === 'tasks' }"
          @click="tasks.activeTab = 'tasks'"
        >
          {{ t('scheduledTasks.tabs.tasks') }}
        </button>
        <button
          type="button"
          class="page-tab"
          :class="{ active: tasks.activeTab === 'templates' }"
          @click="tasks.activeTab = 'templates'"
        >
          {{ t('scheduledTasks.tabs.templates') }}
        </button>
      </div>
      <div ref="createMenuRef" class="create-menu-wrap">
        <button
          type="button"
          class="chat-create-btn"
          :class="{ open: createMenuOpen }"
          @click="toggleCreateMenu"
        >
          <span class="chat-create-label">{{ t('scheduledTasks.createByChat') }}</span>
          <ChevronDown :size="13" class="create-chevron" :class="{ open: createMenuOpen }" />
        </button>
        <div v-if="createMenuOpen" class="create-menu">
          <button type="button" class="create-menu-item" @click="openChatCreate">
            <MessageCircle :size="16" :stroke-width="2" />
            <span>{{ t('scheduledTasks.createByChat') }}</span>
          </button>
          <button type="button" class="create-menu-item" @click="openManualCreate">
            <Pencil :size="16" :stroke-width="2" />
            <span>{{ t('scheduledTasks.createManual') }}</span>
          </button>
        </div>
      </div>
    </div>

    <main v-if="tasks.activeTab === 'tasks'" class="scheduled-content">
      <header class="scheduled-header">
        <h1>{{ t('scheduledTasks.title') }}</h1>
        <p>{{ hasCurrentTasks ? t('scheduledTasks.subtitleActive') : t('scheduledTasks.subtitleEmpty') }}</p>
      </header>

      <label v-if="hasCurrentTasks" class="search-box">
        <Search :size="16" />
        <input
          v-model="tasks.query"
          type="search"
          :placeholder="t('scheduledTasks.searchTasks')"
          @input="tasks.load({ query: tasks.query })"
        />
      </label>

      <div v-if="hasCurrentTasks" class="task-list-panel pretty-scrollbar">
        <section v-if="pendingTasks.length" class="task-section pending-section">
          <h2>{{ t('scheduledTasks.pendingTitle') }}</h2>
          <div class="task-list" role="list">
            <article
              v-for="task in pendingTasks"
              :key="task.id"
              class="task-row pending"
              role="listitem"
              tabindex="0"
              :aria-label="t('scheduledTasks.viewDetails')"
              @click="openTaskDetails(task)"
              @keydown.enter.prevent="openTaskDetails(task)"
              @keydown.space.prevent="openTaskDetails(task)"
            >
              <div class="task-main">
                <div class="task-title-line">
                  <strong>{{ task.title }}</strong>
                  <span v-if="task.projectName">{{ task.projectName }}</span>
                </div>
                <p>{{ t('scheduledTasks.pendingHint', { time: formatTimestamp(task.pendingRunAt) }) }}</p>
              </div>
              <div class="pending-actions">
                <button
                  type="button"
                  class="run-pending"
                  :disabled="running === task.id"
                  :title="t('scheduledTasks.runNow')"
                  @click.stop="runTask(task)"
                >
                  <Play :size="14" />
                  <span>{{ t('scheduledTasks.runNow') }}</span>
                </button>
                <button type="button" class="dismiss-pending" :title="t('scheduledTasks.dismiss')" @click.stop="dismissPending(task)">
                  <X :size="15" />
                </button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="activeTasks.length" class="task-section">
          <h2>{{ t('scheduledTasks.current') }}</h2>
          <div class="task-list" role="list">
            <article
              v-for="task in activeTasks"
              :key="task.id"
              class="task-row"
              role="listitem"
              tabindex="0"
              :aria-label="t('scheduledTasks.viewDetails')"
              @click="openTaskDetails(task)"
              @keydown.enter.prevent="openTaskDetails(task)"
              @keydown.space.prevent="openTaskDetails(task)"
            >
              <div class="task-main">
                <div class="task-title-line">
                  <strong>{{ task.title }}</strong>
                  <span v-if="task.projectName">{{ task.projectName }}</span>
                </div>
                <p>{{ formatScheduleText(task) }}</p>
              </div>
              <div class="row-actions">
                <button type="button" :title="t('scheduledTasks.runNow')" @click.stop="runTask(task)">
                  <Play :size="15" />
                </button>
                <button type="button" :title="t('scheduledTasks.edit')" @click.stop="openTaskEdit(task)">
                  <Pencil :size="15" />
                </button>
                <button type="button" :title="t('scheduledTasks.delete')" @click.stop="deleteTask(task)">
                  <Trash2 :size="15" />
                </button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="pausedTasks.length" class="task-section">
          <h2>{{ t('scheduledTasks.status.paused') }}</h2>
          <div class="task-list" role="list">
            <article
              v-for="task in pausedTasks"
              :key="task.id"
              class="task-row paused"
              role="listitem"
              tabindex="0"
              :aria-label="t('scheduledTasks.viewDetails')"
              @click="openTaskDetails(task)"
              @keydown.enter.prevent="openTaskDetails(task)"
              @keydown.space.prevent="openTaskDetails(task)"
            >
              <div class="task-main">
                <div class="task-title-line">
                  <strong>{{ task.title }}</strong>
                  <span v-if="task.projectName">{{ task.projectName }}</span>
                </div>
                <p>{{ formatScheduleText(task) }}</p>
              </div>
              <div class="row-actions">
                <button type="button" :title="t('scheduledTasks.runNow')" @click.stop="runTask(task)">
                  <Play :size="16" />
                </button>
                <button type="button" :title="t('scheduledTasks.edit')" @click.stop="openTaskEdit(task)">
                  <Pencil :size="16" />
                </button>
                <button type="button" :title="t('scheduledTasks.delete')" @click.stop="deleteTask(task)">
                  <Trash2 :size="16" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div v-else class="empty-state">
        <p>{{ t('scheduledTasks.createFirst') }}</p>
        <div class="quick-actions">
          <button type="button" @click="tasks.createFromTemplate('daily-briefing')">
            <Bell :size="17" />
            {{ t('scheduledTasks.quick.dailyBriefing') }}
          </button>
          <button type="button" @click="tasks.createFromTemplate('weekly-review')">
            <BookOpen :size="17" />
            {{ t('scheduledTasks.quick.weeklyReview') }}
          </button>
          <button type="button" @click="tasks.createFromTemplate('project-monitor')">
            <Search :size="17" />
            {{ t('scheduledTasks.quick.projectMonitor') }}
          </button>
        </div>
      </div>
    </main>

    <main v-else class="scheduled-content">
      <header class="scheduled-header">
        <h1>{{ t('scheduledTasks.templatesTitle') }}</h1>
        <p>{{ t('scheduledTasks.templatesSubtitle') }}</p>
      </header>

      <label class="search-box">
        <Search :size="18" />
        <input
          v-model="tasks.templateQuery"
          type="search"
          :placeholder="t('scheduledTasks.searchTemplates')"
          @input="tasks.loadTemplates(tasks.templateQuery)"
        />
      </label>

      <div class="template-list-panel pretty-scrollbar">
      <section v-if="systemTemplates.length" class="template-section">
        <h2>{{ t('scheduledTasks.templateGroups.system') }}</h2>
        <div class="template-grid">
          <button
            v-for="template in systemTemplates"
            :key="template.id"
            type="button"
            class="template-card"
            @click="createFromTemplate(template)"
          >
            <component :is="templateIcon(template)" :size="22" />
            <strong>{{ template.title }}</strong>
            <p>{{ template.description }}</p>
            <span>{{ template.scheduleText || t('scheduledTasks.unscheduled') }}</span>
          </button>
        </div>
      </section>

      <section v-if="projectTemplates.length" class="template-section">
        <h2>{{ t('scheduledTasks.templateGroups.project') }}</h2>
        <div class="template-grid">
          <button
            v-for="template in projectTemplates"
            :key="template.id"
            type="button"
            class="template-card"
            @click="createFromTemplate(template)"
          >
            <component :is="templateIcon(template)" :size="22" />
            <strong>{{ template.title }}</strong>
            <p>{{ template.description }}</p>
            <span>{{ template.scheduleText || t('scheduledTasks.unscheduled') }}</span>
          </button>
        </div>
      </section>
      </div>
    </main>

    <ScheduledTaskEditDrawer v-model:task="drawerTask" :readonly="drawerReadonly" />
    <ScheduledTaskCreateDialog v-model:open="createFormOpen" />
  </section>
</template>

<style scoped>
.scheduled-page {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #1f1f1f);
}
.scheduled-topbar {
  z-index: 2;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--codex-border, #eeeeee);
  padding: 8px 16px;
  background: color-mix(in srgb, var(--codex-bg, #fff) 96%, transparent);
  backdrop-filter: blur(12px);
}
.page-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.page-tab,
.chat-create-btn,
.quick-actions button,
.row-actions button {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--codex-muted, #8d8d8d);
  font-size: 13px;
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.page-tab {
  padding: 6px 10px;
}
.page-tab.active {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.chat-create-btn,
.quick-actions button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.create-menu-wrap {
  position: relative;
  flex-shrink: 0;
}
.chat-create-btn {
  padding: 6px 10px;
  border-color: var(--codex-border, #ddd);
  color: var(--codex-text, #1f1f1f);
}
.chat-create-label {
  line-height: 1.2;
}
.create-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.create-chevron.open {
  transform: rotate(180deg);
}
.create-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 210px;
  padding: 6px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 12px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 10px 28px color-mix(in srgb, #000 10%, transparent);
}
.create-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  line-height: 1.2;
  text-align: left;
  transition: background 0.15s ease;
}
.create-menu-item:hover {
  background: var(--codex-hover, #f0f0f0);
}
.create-menu-item svg {
  flex-shrink: 0;
  color: var(--codex-text-secondary, #6d6d6d);
}
.scheduled-content {
  display: flex;
  width: min(860px, calc(100% - 48px));
  min-height: 0;
  flex: 1;
  flex-direction: column;
  margin: 0 auto;
  padding: 28px 0 20px;
  overflow: hidden;
}
.task-list-panel,
.template-list-panel {
  flex: 1;
  min-height: 0;
  margin-top: 16px;
  overflow-y: auto;
}
.scheduled-header {
  flex-shrink: 0;
}
.scheduled-header h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: 0;
}
.scheduled-header p {
  margin: 8px 0 16px;
  color: var(--codex-muted, #8f8f8f);
  font-size: 14px;
}
.search-box {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--codex-border, #dedede);
  border-radius: 18px;
  color: var(--codex-muted, #999);
  font-size: 14px;
}
.search-box input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--codex-text, #1f1f1f);
  font: inherit;
}
.task-section + .task-section,
.template-section + .template-section {
  margin-top: 20px;
}
.task-list-panel .task-section:first-child,
.template-list-panel .template-section:first-child {
  margin-top: 0;
}
.task-section h2,
.template-section h2 {
  margin: 0 0 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--codex-border, #e8e8e8);
  font-size: 15px;
  font-weight: 650;
}
.task-list {
  display: grid;
  gap: 8px;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 6px;
  border-radius: 8px;
  cursor: pointer;
  outline: 0;
  transition: background 0.15s ease;
}
.task-row:hover,
.task-row:focus-visible {
  background: color-mix(in srgb, var(--codex-hover, #f5f5f5) 65%, transparent);
}
.task-row:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--codex-text, #1f1f1f) 20%, transparent);
}
.task-row.paused {
  opacity: 0.88;
}
.pending-section h2 {
  color: #b45309;
  border-bottom-color: color-mix(in srgb, #d97706 30%, var(--codex-border, #e8e8e8));
}
.task-row.pending {
  background: color-mix(in srgb, #d97706 8%, transparent);
  padding-left: 14px;
  padding-right: 12px;
}
.pending-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
}
.run-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 92px;
  height: 32px;
  padding: 0 13px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, #d97706 40%, var(--codex-border, #ddd));
  background: color-mix(in srgb, #d97706 12%, transparent);
  color: #b45309;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.run-pending:hover:not(:disabled) {
  background: color-mix(in srgb, #d97706 20%, transparent);
  border-color: color-mix(in srgb, #d97706 58%, var(--codex-border, #ddd));
  color: #92400e;
}
.run-pending:disabled {
  opacity: 0.6;
}
.dismiss-pending {
  display: inline-grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 8px;
  color: color-mix(in srgb, #b45309 55%, var(--codex-muted, #8d8d8d));
  transition: background 0.15s ease, color 0.15s ease;
}
.dismiss-pending:hover {
  background: color-mix(in srgb, #d97706 13%, transparent);
  color: #92400e;
}
.task-main {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.task-title-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.task-title-line strong {
  overflow: hidden;
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-title-line span,
.task-main p {
  color: var(--codex-muted, #9a9a9a);
}
.task-main p {
  margin: 6px 0 0;
  font-size: 14px;
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.task-row:hover .row-actions,
.task-row:focus-within .row-actions {
  opacity: 1;
}
.row-actions button {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--codex-muted, #8d8d8d);
}
.chat-create-btn:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.row-actions button:hover,
.quick-actions button:hover {
  background: var(--codex-hover, #eeeeee);
  color: var(--codex-text, #1f1f1f);
}
.empty-state {
  display: grid;
  flex: 1;
  min-height: 0;
  place-content: center;
  text-align: center;
}
.empty-state p {
  margin: 0 0 22px;
  font-size: 16px;
  font-weight: 650;
}
.quick-actions {
  display: flex;
  gap: 10px;
}
.quick-actions button {
  padding: 10px 16px;
  border-color: var(--codex-border, #ddd);
  color: var(--codex-text, #1f1f1f);
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.template-card {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  min-height: 170px;
  padding: 20px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: var(--codex-text, #1f1f1f);
}
.template-card:hover {
  background: var(--codex-hover, #f6f6f6);
}
.template-card strong {
  margin-top: 16px;
  font-size: 15px;
}
.template-card p {
  margin: 10px 0 18px;
  color: var(--codex-text, #2b2b2b);
  font-size: 14px;
  line-height: 1.55;
}
.template-card span {
  color: var(--codex-muted, #9a9a9a);
  font-size: 13px;
}
@media (max-width: 760px) {
  .scheduled-content {
    width: min(100% - 32px, 860px);
    padding-top: 20px;
  }
  .template-grid,
  .quick-actions {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
  .row-actions {
    opacity: 1;
  }
  .task-row.pending {
    align-items: flex-start;
  }
  .pending-actions {
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .run-pending {
    min-width: 84px;
    padding: 0 10px;
  }
}
</style>
