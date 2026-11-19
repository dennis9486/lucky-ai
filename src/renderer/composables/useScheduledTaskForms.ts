import { reactive, ref } from 'vue'
import type {
  ScheduledTask,
  ScheduledTaskCadence,
  ScheduledTaskRunMode
} from '../../shared/types/scheduled-task.js'
import {
  DEFAULT_SCHEDULE_TIME,
  applyScheduleToForm,
  formatDateInput,
  normalizeScheduleTime,
  scheduleTimeParts,
  type IntervalUnit,
  type ScheduleFrequencyMode
} from '../utils/scheduled-task-form.js'

interface ScheduledTaskFormState {
  title: string
  prompt: string
  projectName: string
  frequencyMode: ScheduleFrequencyMode
  cadence: ScheduledTaskCadence
  scheduleText: string
  intervalEvery: number
  intervalUnit: IntervalUnit
  weeklyDay: number
  monthlyDay: number
  onceDate: string
  runMode: ScheduledTaskRunMode
}

function createBaseForm(overrides: Partial<ScheduledTaskFormState> = {}): ScheduledTaskFormState {
  return {
    title: '',
    prompt: '',
    projectName: '',
    frequencyMode: 'periodic',
    cadence: 'daily',
    scheduleText: DEFAULT_SCHEDULE_TIME,
    intervalEvery: 30,
    intervalUnit: 'minute',
    weeklyDay: 1,
    monthlyDay: 1,
    onceDate: formatDateInput(Date.now()),
    runMode: 'notify',
    ...overrides
  }
}

export function useScheduledTaskForms() {
  const activeTimePicker = ref<'edit' | 'create' | null>(null)
  const editForm = reactive(createBaseForm({ cadence: 'custom', scheduleText: '' }))
  const createForm = reactive(createBaseForm())

  function fillEditForm(task: ScheduledTask): void {
    editForm.title = task.title
    editForm.prompt = task.prompt
    editForm.projectName = task.projectName ?? ''
    applyScheduleToForm(editForm, task.cadence, task.scheduleText, task.nextRunAt)
    editForm.runMode = task.runMode
  }

  function resetCreateForm(projectName = ''): void {
    Object.assign(createForm, createBaseForm({ projectName }))
  }

  function scheduleTimeValue(target: 'edit' | 'create'): string {
    return target === 'edit' ? editForm.scheduleText : createForm.scheduleText
  }

  function setScheduleTime(target: 'edit' | 'create', part: 'hour' | 'minute', next: string): void {
    const current = scheduleTimeParts(scheduleTimeValue(target))
    const value = part === 'hour' ? `${next}:${current.minute}` : `${current.hour}:${next}`
    if (target === 'edit') editForm.scheduleText = value
    else createForm.scheduleText = value
  }

  function openTimePicker(target: 'edit' | 'create'): void {
    activeTimePicker.value = target
  }

  function closeTimePicker(): void {
    activeTimePicker.value = null
  }

  function normalizeScheduleTimeInput(target: 'edit' | 'create'): void {
    const value = normalizeScheduleTime(scheduleTimeValue(target), DEFAULT_SCHEDULE_TIME)
    if (target === 'edit') editForm.scheduleText = value
    else createForm.scheduleText = value
  }

  function normalizeActiveScheduleTime(target: 'edit' | 'create'): void {
    const form = target === 'edit' ? editForm : createForm
    if (form.frequencyMode !== 'interval' && form.cadence !== 'custom') {
      form.scheduleText = normalizeScheduleTime(form.scheduleText, DEFAULT_SCHEDULE_TIME)
    }
  }

  return {
    activeTimePicker,
    editForm,
    createForm,
    fillEditForm,
    resetCreateForm,
    scheduleTimeValue,
    setScheduleTime,
    openTimePicker,
    closeTimePicker,
    normalizeScheduleTimeInput,
    normalizeActiveScheduleTime
  }
}

