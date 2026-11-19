<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { useScheduledTaskStore } from '../../stores/scheduled-task.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useScheduledTaskForms } from '../../composables/useScheduledTaskForms.js'
import type { ScheduledTaskRunMode } from '../../../shared/types/scheduled-task.js'
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
 * 手动创建已安排任务的对话框。表单归本组件所有，
 * 打开时按当前活动项目重置；提交直接走 store，成功后自行关闭。
 */
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const tasks = useScheduledTaskStore()
const projects = useProjectStore()

const creating = ref(false)
const titleInputRef = ref<HTMLInputElement | null>(null)
const { createForm, resetCreateForm, normalizeActiveScheduleTime } = useScheduledTaskForms()
const runModeOptions: ScheduledTaskRunMode[] = ['notify', 'auto']

const projectOptions = computed(() => {
  const names = new Set(projects.projects.map((item) => item.name))
  if (createForm.projectName) names.add(createForm.projectName)
  return [...names]
})
const canSubmit = computed(() => Boolean(createForm.title.trim() && createForm.prompt.trim()))

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    resetCreateForm(projects.activeProject?.name ?? '')
    await nextTick()
    titleInputRef.value?.focus()
  }
)

watch(
  () => [createForm.frequencyMode, createForm.cadence] as const,
  ([frequencyMode, cadence]) => {
    if (frequencyMode !== 'interval' && cadence !== 'custom') normalizeActiveScheduleTime('create')
  }
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  creating.value = true
  try {
    await tasks.create({
      title: createForm.title.trim(),
      prompt: createForm.prompt.trim(),
      projectName: createForm.projectName || null,
      cadence: cadenceForSubmit(createForm),
      scheduleText: scheduleTextForSubmit(createForm),
      nextRunAt: onceNextRunAt(createForm),
      runMode: createForm.runMode,
      source: 'manual'
    })
    close()
  } finally {
    creating.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="create-form-backdrop" @click.self="close" />
    </Transition>
    <Transition name="drawer-fade">
      <form
        v-if="open"
        class="create-form-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('scheduledTasks.createManual')"
        @submit.prevent="submit"
        @keydown="onKeydown"
      >
        <header class="create-form-header">
          <div>
            <h2>{{ t('scheduledTasks.manualFormTitle') }}</h2>
            <p>{{ t('scheduledTasks.manualFormSubtitle') }}</p>
          </div>
          <button type="button" class="create-form-close" :title="t('common.close')" @click="close">
            <X :size="18" />
          </button>
        </header>

        <div class="create-form-body">
          <label class="create-field">
            <span>{{ t('scheduledTasks.fields.title') }}</span>
            <input
              ref="titleInputRef"
              v-model="createForm.title"
              type="text"
              :placeholder="t('scheduledTasks.manualDefaultTitle')"
              required
            />
          </label>

          <label class="create-field">
            <span>{{ t('scheduledTasks.fields.prompt') }}</span>
            <textarea
              v-model="createForm.prompt"
              rows="6"
              :placeholder="t('scheduledTasks.promptPlaceholder')"
              required
            />
          </label>

          <div class="create-field-grid">
            <label class="create-field">
              <span>{{ t('scheduledTasks.fields.project') }}</span>
              <select v-model="createForm.projectName">
                <option value="">{{ t('scheduledTasks.noProject') }}</option>
                <option v-for="name in projectOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <label class="create-field">
              <span>{{ t('scheduledTasks.fields.frequency') }}</span>
              <select v-model="createForm.frequencyMode">
                <option v-for="mode in frequencyModeOptions" :key="mode" :value="mode">
                  {{ t(`scheduledTasks.frequency.${mode}`) }}
                </option>
              </select>
            </label>
          </div>

          <div v-if="createForm.frequencyMode === 'periodic'" class="create-field-grid compact">
            <label class="create-field">
              <span>{{ t('scheduledTasks.fields.repeat') }}</span>
              <select v-model="createForm.cadence">
                <option v-for="cadence in periodicCadences" :key="cadence" :value="cadence">
                  {{ t(`scheduledTasks.cadence.${cadence}`) }}
                </option>
              </select>
            </label>
            <label v-if="createForm.cadence === 'weekly'" class="create-field">
              <span>{{ t('scheduledTasks.fields.schedule') }}</span>
              <select v-model.number="createForm.weeklyDay">
                <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
              </select>
            </label>
            <label v-else-if="createForm.cadence === 'monthly'" class="create-field">
              <span>{{ t('scheduledTasks.fields.schedule') }}</span>
              <input v-model.number="createForm.monthlyDay" type="number" min="1" max="31" />
            </label>
          </div>

          <div v-if="createForm.frequencyMode === 'interval'" class="create-field-grid compact">
            <label class="create-field">
              <span>{{ t('scheduledTasks.frequency.interval') }}</span>
              <input v-model.number="createForm.intervalEvery" type="number" min="1" max="999" />
            </label>
            <label class="create-field">
              <span>{{ t('scheduledTasks.fields.intervalUnit') }}</span>
              <select v-model="createForm.intervalUnit">
                <option v-for="unit in intervalUnits" :key="unit" :value="unit">{{ t(`scheduledTasks.intervalUnit.${unit}`) }}</option>
              </select>
            </label>
          </div>

          <div v-if="createForm.frequencyMode === 'once'" class="create-field-grid compact">
            <label class="create-field">
              <span>{{ t('scheduledTasks.frequency.once') }}</span>
              <input v-model="createForm.onceDate" type="date" />
            </label>
          </div>

          <label v-if="createForm.frequencyMode !== 'interval'" class="create-field create-time-field" @click.stop>
            <span>{{ t('scheduledTasks.fields.schedule') }}</span>
            <ScheduleTimeField v-model="createForm.scheduleText" popover-align="left" class="create-time-control" />
          </label>

          <label class="create-field">
            <span>{{ t('scheduledTasks.fields.runMode') }}</span>
            <select v-model="createForm.runMode">
              <option v-for="mode in runModeOptions" :key="mode" :value="mode">
                {{ t(`scheduledTasks.runMode.${mode}`) }}
              </option>
            </select>
          </label>
        </div>

        <footer class="create-form-footer">
          <button type="button" class="dialog-btn ghost" @click="close">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="dialog-btn primary" :disabled="creating || !canSubmit">
            {{ t('scheduledTasks.createTask') }}
          </button>
        </footer>
      </form>
    </Transition>
  </Teleport>
</template>

<style scoped>
.create-form-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: color-mix(in srgb, #000 18%, transparent);
}
.create-form-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 70;
  display: flex;
  width: min(500px, calc(100vw - 32px));
  max-height: min(90vh, 720px);
  flex-direction: column;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 12px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 24px 60px color-mix(in srgb, #000 14%, transparent);
  transform: translate(-50%, -50%);
}
.create-form-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 0;
}
.create-form-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
}
.create-form-header p {
  margin: 8px 0 0;
  color: var(--codex-muted, #8f8f8f);
  font-size: 14px;
  line-height: 1.5;
}
.create-form-close {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--codex-muted, #8d8d8d);
}
.create-form-close:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.create-form-body {
  display: grid;
  gap: 14px;
  padding: 20px 24px;
  overflow: auto;
}
.create-field {
  display: grid;
  gap: 7px;
}
.create-field span {
  color: var(--codex-text, #1f1f1f);
  font-size: 13px;
  font-weight: 600;
}
.create-field input,
.create-field textarea,
.create-field select {
  width: 100%;
  min-height: 36px;
  padding: 8px 11px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #1f1f1f);
  font: inherit;
  outline: 0;
  resize: vertical;
}
.create-field textarea {
  min-height: 132px;
  line-height: 1.65;
}
.create-field input:focus,
.create-field textarea:focus,
.create-field select:focus {
  border-color: color-mix(in srgb, var(--codex-text, #1f1f1f) 28%, var(--codex-border, #e4e4e4));
}
.create-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.create-field-grid.compact {
  gap: 10px;
}
.create-time-field .create-time-control {
  width: 100%;
}
.create-time-field :deep(.time-trigger) {
  min-height: 36px;
}
.create-time-field :deep(.time-trigger input) {
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
}
.create-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 4px 24px 22px;
}
.dialog-btn {
  border: 0;
  border-radius: 10px;
  padding: 8px 16px;
  background: transparent;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.dialog-btn.ghost {
  color: var(--codex-muted, #8d8d8d);
}
.dialog-btn.ghost:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.dialog-btn.primary {
  background: var(--codex-text, #1f1f1f);
  color: var(--codex-bg, #fff);
}
.dialog-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
.dialog-btn.primary:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}
@media (max-width: 760px) {
  .create-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
