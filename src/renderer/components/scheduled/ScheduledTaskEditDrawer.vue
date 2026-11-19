<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDown,
  CirclePause,
  Info,
  PanelRightClose,
  Save,
  Trash2,
  X
} from 'lucide-vue-next'
import { useScheduledTaskStore } from '../../stores/scheduled-task.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useFocusTrap } from '../../composables/useFocusTrap.js'
import { useScheduledTaskForms } from '../../composables/useScheduledTaskForms.js'
import { formatMessageTimestamp } from '../../utils/time.js'
import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskRunMode } from '../../../shared/types/scheduled-task.js'
import {
  cadenceForSubmit,
  frequencyModeOptions,
  intervalUnits,
  onceNextRunAt,
  periodicCadences,
  scheduleTextForSubmit,
  weekdayOptions
} from '../../utils/scheduled-task-form.js'
import ScheduleTimeField from './ScheduleTimeField.vue'

/**
 * 已安排任务的编辑抽屉：标题/提示词/排期字段 + 运行历史。
 * 通过 v-model:task 与列表页同步（null 即关闭），保存/暂停/删除直接走 store。
 */
const props = defineProps<{
  task: ScheduledTask | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:task', task: ScheduledTask | null): void
}>()

const { t } = useI18n()
const tasks = useScheduledTaskStore()
const projects = useProjectStore()

const drawerRef = ref<HTMLElement | null>(null)
const open = computed(() => Boolean(props.task))
// 打开抽屉时把焦点移入并锁在其中，关闭后还给触发的列表项
useFocusTrap(drawerRef, open)

const saving = ref(false)
const runs = ref<ScheduledTaskRun[]>([])
const runsLoading = ref(false)
const { editForm, fillEditForm, normalizeActiveScheduleTime } = useScheduledTaskForms()
const runModeOptions: ScheduledTaskRunMode[] = ['notify', 'auto']
const isReadonly = computed(() => Boolean(props.readonly))

const projectOptions = computed(() => {
  const names = new Set(projects.projects.map((item) => item.name))
  if (editForm.projectName) names.add(editForm.projectName)
  return [...names]
})

watch(
  () => props.task,
  (task) => {
    document.body.style.overflow = task ? 'hidden' : ''
    if (!task) return
    fillEditForm(task)
    runs.value = []
    void loadRuns(task.id)
  }
)

watch(
  () => [editForm.frequencyMode, editForm.cadence] as const,
  ([frequencyMode, cadence]) => {
    if (frequencyMode !== 'interval' && cadence !== 'custom') normalizeActiveScheduleTime('edit')
  }
)

onUnmounted(() => {
  document.body.style.overflow = ''
})

async function loadRuns(taskId: string): Promise<void> {
  runsLoading.value = true
  try {
    const list = await tasks.listRuns(taskId)
    // 期间抽屉可能已切换到别的任务，避免串号
    if (props.task?.id === taskId) runs.value = list
  } catch {
    if (props.task?.id === taskId) runs.value = []
  } finally {
    runsLoading.value = false
  }
}

function close(): void {
  emit('update:task', null)
}

async function saveEdit(): Promise<void> {
  if (!props.task || isReadonly.value) return
  saving.value = true
  try {
    await tasks.update({
      id: props.task.id,
      title: editForm.title,
      prompt: editForm.prompt,
      projectName: editForm.projectName || null,
      cadence: cadenceForSubmit(editForm),
      scheduleText: scheduleTextForSubmit(editForm),
      nextRunAt: onceNextRunAt(editForm),
      runMode: editForm.runMode
    })
    close()
  } finally {
    saving.value = false
  }
}

async function togglePause(task: ScheduledTask): Promise<void> {
  const updated = await tasks.update({ id: task.id, status: task.status === 'paused' ? 'active' : 'paused' })
  if (updated && props.task?.id === task.id) emit('update:task', updated)
}

async function deleteTask(task: ScheduledTask): Promise<void> {
  if (!window.confirm(t('scheduledTasks.deleteConfirm', { title: task.title }))) return
  await tasks.archive(task.id)
  close()
}

function statusLabel(task: ScheduledTask): string {
  return task.status === 'paused' ? t('scheduledTasks.status.paused') : t('scheduledTasks.status.active')
}

function formatTimestamp(value?: number | null): string {
  if (!value) return t('scheduledTasks.never')
  return formatMessageTimestamp(value)
}

function runStatusLabel(run: ScheduledTaskRun): string {
  return t(`scheduledTasks.runStatus.${run.status}`)
}

function runTriggerLabel(run: ScheduledTaskRun): string {
  return t(`scheduledTasks.runTrigger.${run.trigger}`)
}

function formatScheduleText(task: ScheduledTask): string {
  return task.scheduleText || t(`scheduledTasks.cadence.${task.cadence}`)
}

function onDrawerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <Transition name="drawer-fade">
    <div v-if="task" class="drawer-backdrop" @click="close" />
  </Transition>

  <Transition name="drawer-slide">
    <aside
      v-if="task"
      ref="drawerRef"
      class="edit-drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="isReadonly ? t('scheduledTasks.viewDetails') : t('scheduledTasks.edit')"
      @keydown="onDrawerKeydown"
    >
      <div class="drawer-toolbar">
        <h2 v-if="isReadonly" class="drawer-title-text">{{ task.title }}</h2>
        <input
          v-else
          v-model="editForm.title"
          class="drawer-title-input"
          type="text"
          :placeholder="t('scheduledTasks.fields.title')"
        />
        <div class="drawer-toolbar-actions">
          <button
            v-if="!isReadonly"
            type="button"
            class="icon-btn"
            :title="task.status === 'paused' ? t('scheduledTasks.resume') : t('scheduledTasks.pause')"
            :aria-label="task.status === 'paused' ? t('scheduledTasks.resume') : t('scheduledTasks.pause')"
            @click="togglePause(task)"
          >
            <CirclePause :size="17" />
          </button>
          <button
            v-if="!isReadonly"
            type="button"
            class="icon-btn"
            :title="t('scheduledTasks.delete')"
            :aria-label="t('scheduledTasks.delete')"
            @click="deleteTask(task)"
          >
            <Trash2 :size="17" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <PanelRightClose :size="17" />
          </button>
        </div>
      </div>

      <div class="drawer-body pretty-scrollbar">
        <div v-if="isReadonly" class="drawer-prompt-preview">
          {{ task.prompt }}
        </div>
        <textarea
          v-else
          v-model="editForm.prompt"
          class="drawer-prompt-input"
          rows="10"
          :placeholder="t('scheduledTasks.fields.prompt')"
        />

        <section class="drawer-section">
          <h3>{{ t('scheduledTasks.statusTitle') }}</h3>
          <dl class="drawer-meta">
            <div>
              <dt>{{ t('scheduledTasks.fields.status') }}</dt>
              <dd>
                <span class="status-pill" :class="task.status">
                  <span class="status-dot" />
                  {{ statusLabel(task) }}
                </span>
              </dd>
            </div>
            <div>
              <dt>{{ t('scheduledTasks.fields.nextRun') }}</dt>
              <dd>{{ task.nextRunAt ? formatTimestamp(task.nextRunAt) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('scheduledTasks.fields.lastRun') }}</dt>
              <dd>{{ task.lastRunAt ? formatTimestamp(task.lastRunAt) : t('scheduledTasks.never') }}</dd>
            </div>
          </dl>
        </section>

        <section class="drawer-section">
          <h3>{{ t('scheduledTasks.detailsTitle') }}</h3>
          <div class="field-list">
            <label class="field-row">
              <span class="field-label">
                {{ t('scheduledTasks.fields.environment') }}
                <Info :size="14" />
              </span>
              <span class="field-control readonly">
                {{ t('scheduledTasks.local') }}
                <ChevronDown v-if="!isReadonly" :size="14" />
              </span>
            </label>

            <label class="field-row">
              <span class="field-label">{{ t('scheduledTasks.fields.project') }}</span>
              <span v-if="isReadonly" class="field-value-readonly">
                {{ task.projectName || t('scheduledTasks.noProject') }}
              </span>
              <span v-else class="field-control">
                <select v-model="editForm.projectName">
                  <option value="">{{ t('scheduledTasks.noProject') }}</option>
                  <option v-for="name in projectOptions" :key="name" :value="name">{{ name }}</option>
                </select>
                <ChevronDown :size="14" class="field-chevron" />
              </span>
            </label>

            <label class="field-row">
              <span class="field-label">{{ t('scheduledTasks.fields.frequency') }}</span>
              <span v-if="isReadonly" class="field-value-readonly">
                {{ t(`scheduledTasks.cadence.${task.cadence}`) }}
              </span>
              <span v-else class="field-control">
                <select v-model="editForm.frequencyMode">
                  <option v-for="mode in frequencyModeOptions" :key="mode" :value="mode">
                    {{ t(`scheduledTasks.frequency.${mode}`) }}
                  </option>
                </select>
                <ChevronDown :size="14" class="field-chevron" />
              </span>
            </label>

            <label v-if="!isReadonly && editForm.frequencyMode === 'periodic'" class="field-row">
              <span class="field-label">{{ t('scheduledTasks.fields.repeat') }}</span>
              <span class="field-control split-control">
                <select v-model="editForm.cadence">
                  <option v-for="cadence in periodicCadences" :key="cadence" :value="cadence">
                    {{ t(`scheduledTasks.cadence.${cadence}`) }}
                  </option>
                </select>
                <select v-if="editForm.cadence === 'weekly'" v-model.number="editForm.weeklyDay">
                  <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
                </select>
                <span v-if="editForm.cadence === 'monthly'" class="field-control day-control">
                  <input v-model.number="editForm.monthlyDay" type="number" min="1" max="31" />
                  <em>{{ t('scheduledTasks.timePicker.dayOfMonth') }}</em>
                </span>
                <ChevronDown v-if="editForm.cadence !== 'monthly'" :size="14" class="field-chevron" />
              </span>
            </label>

            <label v-if="!isReadonly && editForm.frequencyMode === 'interval'" class="field-row">
              <span class="field-label">{{ t('scheduledTasks.frequency.interval') }}</span>
              <span class="field-control split-control">
                <input v-model.number="editForm.intervalEvery" class="compact-number" type="number" min="1" max="999" />
                <select v-model="editForm.intervalUnit">
                  <option v-for="unit in intervalUnits" :key="unit" :value="unit">{{ t(`scheduledTasks.intervalUnit.${unit}`) }}</option>
                </select>
                <ChevronDown :size="14" class="field-chevron" />
              </span>
            </label>

            <label v-if="!isReadonly && editForm.frequencyMode === 'once'" class="field-row">
              <span class="field-label">{{ t('scheduledTasks.frequency.once') }}</span>
              <span class="field-control">
                <input v-model="editForm.onceDate" type="date" />
              </span>
            </label>

            <div v-if="isReadonly || editForm.frequencyMode !== 'interval'" class="field-row">
              <span class="field-label">{{ t('scheduledTasks.fields.schedule') }}</span>
              <span v-if="isReadonly" class="field-value-readonly">{{ formatScheduleText(task) }}</span>
              <ScheduleTimeField v-else v-model="editForm.scheduleText" input-align="right" />
            </div>

            <label class="field-row">
              <span class="field-label">
                {{ t('scheduledTasks.fields.runMode') }}
                <Info :size="14" />
              </span>
              <span v-if="isReadonly" class="field-value-readonly">
                {{ t(`scheduledTasks.runMode.${task.runMode}`) }}
              </span>
              <span v-else class="field-control">
                <select v-model="editForm.runMode">
                  <option v-for="mode in runModeOptions" :key="mode" :value="mode">
                    {{ t(`scheduledTasks.runMode.${mode}`) }}
                  </option>
                </select>
                <ChevronDown :size="14" class="field-chevron" />
              </span>
            </label>
          </div>
        </section>

        <section class="drawer-section">
          <h3>{{ t('scheduledTasks.historyTitle') }}</h3>
          <p v-if="runsLoading && !runs.length" class="history-empty">
            {{ t('scheduledTasks.historyLoading') }}
          </p>
          <div v-else-if="runs.length" class="history-list">
            <div v-for="run in runs" :key="run.id" class="history-row">
              <span class="history-dot" :class="`status-${run.status}`" />
              <strong>{{ runStatusLabel(run) }}</strong>
              <span class="history-trigger">{{ runTriggerLabel(run) }}</span>
              <em>{{ formatTimestamp(run.createdAt) }}</em>
              <p v-if="run.note" class="history-note">{{ run.note }}</p>
            </div>
          </div>
          <p v-else class="history-empty">{{ t('scheduledTasks.noRuns') }}</p>
        </section>
      </div>

      <footer class="drawer-footer">
        <button type="button" class="footer-btn" @click="close">
          <X :size="16" />
          {{ isReadonly ? t('common.close') : t('common.cancel') }}
        </button>
        <button v-if="!isReadonly" type="button" class="footer-btn primary" :disabled="saving" @click="saveEdit">
          <Save :size="16" />
          {{ t('common.save') }}
        </button>
      </footer>
    </aside>
  </Transition>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: color-mix(in srgb, #000 18%, transparent);
}
.edit-drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 50;
  display: flex;
  width: min(480px, 100vw);
  height: 100%;
  flex-direction: column;
  border-left: 1px solid var(--codex-border, #e8e8e8);
  background: var(--codex-bg, #fff);
  box-shadow: -12px 0 40px color-mix(in srgb, #000 8%, transparent);
}
.drawer-toolbar button,
.drawer-footer button {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--codex-muted, #8d8d8d);
  font-size: 13px;
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.drawer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--codex-border, #eeeeee);
}
.drawer-title-input {
  min-width: 0;
  flex: 1;
  margin: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--codex-text, #1f1f1f);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.3;
}
.drawer-title-text {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--codex-text, #1f1f1f);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.3;
  word-break: break-word;
}
.drawer-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.icon-btn {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  color: var(--codex-muted, #8d8d8d);
}
.icon-btn:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 24px 12px;
}
.drawer-prompt-input {
  width: 100%;
  min-height: 220px;
  margin: 0 0 34px;
  padding: 12px 14px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  outline: 0;
  resize: vertical;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #1f1f1f);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.75;
}
.drawer-prompt-input:focus {
  border-color: color-mix(in srgb, var(--codex-text, #1f1f1f) 28%, var(--codex-border, #e4e4e4));
}
.drawer-prompt-preview {
  min-height: 160px;
  margin: 0 0 34px;
  padding: 14px 0;
  color: var(--codex-text, #1f1f1f);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
.drawer-section {
  margin-bottom: 34px;
}
.drawer-section h3 {
  margin: 0 0 16px;
  color: var(--codex-text-secondary, #3a3a3a);
  font-size: 15px;
  font-weight: 650;
}
.drawer-meta {
  display: grid;
  gap: 14px;
  margin: 0;
}
.drawer-meta div {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) auto;
  gap: 20px;
  align-items: center;
}
.drawer-meta dt {
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  font-weight: 500;
}
.drawer-meta dd {
  margin: 0;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  text-align: right;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 500;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3f9f6f;
}
.status-pill.paused .status-dot {
  background: #d97706;
}
.status-pill.paused {
  color: #b45309;
}
.field-list {
  display: grid;
  gap: 2px;
}
.field-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(160px, 1.2fr);
  gap: 16px;
  align-items: center;
  min-height: 44px;
  padding: 6px 0;
}
.day-control {
  position: relative;
}
.day-control input {
  padding-right: 30px;
}
.day-control em {
  position: absolute;
  right: 10px;
  color: var(--codex-muted, #8f8f8f);
  font-size: 12px;
  font-style: normal;
  pointer-events: none;
}
.field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  font-weight: 500;
}
.field-value-readonly {
  min-width: 0;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
}
.field-control {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}
.field-control.readonly {
  gap: 6px;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
}
.field-control select,
.field-control input {
  width: 100%;
  min-height: 34px;
  padding: 6px 28px 6px 10px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #1f1f1f);
  font: inherit;
  text-align: right;
  appearance: none;
}
.field-control input {
  text-align: left;
  padding-right: 10px;
}
.field-control.split-control {
  gap: 8px;
}
.field-control.split-control > select,
.field-control.split-control > input,
.field-control.split-control > .day-control {
  flex: 1 1 0;
  min-width: 0;
}
.field-control.split-control > .compact-number {
  flex: 0 0 84px;
  text-align: center;
}
.field-control.split-control > .field-chevron {
  right: 8px;
}
.field-chevron {
  position: absolute;
  right: 10px;
  pointer-events: none;
  color: var(--codex-muted, #9a9a9a);
}
.history-list {
  display: grid;
  gap: 10px;
}
.history-row {
  display: grid;
  grid-template-columns: 8px auto auto 1fr;
  align-items: center;
  gap: 6px 12px;
}
.history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--codex-muted, #9a9a9a);
}
.history-dot.status-ok {
  background: var(--codex-success, #2fb344);
}
.history-dot.status-error {
  background: var(--codex-danger, #e5484d);
}
.history-dot.status-skipped {
  background: var(--codex-muted, #9a9a9a);
}
.history-trigger {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-muted, #7a7a7a);
  font-size: 12px;
}
.history-note {
  grid-column: 1 / -1;
  margin: 0;
  padding-left: 20px;
  color: var(--codex-danger, #e5484d);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}
.history-row strong {
  overflow: hidden;
  color: var(--codex-text, #1f1f1f);
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-row em {
  justify-self: end;
  color: var(--codex-muted, #9a9a9a);
  font-size: 13px;
  font-style: normal;
}
.history-empty {
  margin: 0;
  color: var(--codex-muted, #9a9a9a);
  font-size: 14px;
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--codex-border, #eeeeee);
  background: color-mix(in srgb, var(--codex-bg, #fff) 92%, var(--codex-hover, #f5f5f5));
}
.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 14px;
  border-color: var(--codex-border, #ddd);
  color: var(--codex-text, #1f1f1f);
}
.footer-btn.primary {
  border-color: transparent;
  background: var(--codex-text, #1f1f1f);
  color: var(--codex-bg, #fff);
}
.footer-btn:disabled {
  opacity: 0.6;
}
.footer-btn:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
}
.footer-btn.primary:hover:not(:disabled) {
  opacity: 0.92;
  background: var(--codex-text, #1f1f1f);
}
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
@media (max-width: 760px) {
  .field-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
