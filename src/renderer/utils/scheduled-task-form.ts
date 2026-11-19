import type { ScheduledTaskCadence } from '../../shared/types/scheduled-task.js'

export type ScheduleFrequencyMode = 'periodic' | 'interval' | 'once'
export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface WeekdayOption {
  value: number
  label: string
}

export interface ScheduledTaskFormLike {
  frequencyMode: ScheduleFrequencyMode
  cadence: ScheduledTaskCadence
  scheduleText: string
  intervalEvery: number
  intervalUnit: IntervalUnit
  weeklyDay: number
  monthlyDay: number
  onceDate: string
}

export const DEFAULT_SCHEDULE_TIME = '09:00'
export const TIME_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/
export const COMPACT_TIME_PATTERN = /^([01]?\d|2[0-3])([0-5]\d)$/
export const periodicCadences: ScheduledTaskCadence[] = ['daily', 'workdays', 'weekly', 'monthly']
export const frequencyModeOptions: ScheduleFrequencyMode[] = ['periodic', 'interval', 'once']
export const intervalUnits: IntervalUnit[] = ['minute', 'hour', 'day', 'week', 'month']
export const weekdayOptions: WeekdayOption[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' }
]

const UNIT_LABELS: Record<IntervalUnit, string> = {
  minute: '分钟',
  hour: '小时',
  day: '天',
  week: '周',
  month: '月'
}

const UNIT_ALIASES: Record<string, IntervalUnit> = {
  分钟: 'minute',
  分: 'minute',
  小时: 'hour',
  钟头: 'hour',
  时: 'hour',
  天: 'day',
  日: 'day',
  周: 'week',
  星期: 'week',
  礼拜: 'week',
  月: 'month'
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function normalizeScheduleTime(value: string, fallback = ''): string {
  const trimmed = value.trim()
  const match = trimmed.match(TIME_PATTERN) ?? trimmed.match(COMPACT_TIME_PATTERN)
  const hour = match?.[1]
  const minute = match?.[2]
  if (!hour || !minute) return fallback
  return `${hour.padStart(2, '0')}:${minute}`
}

export function scheduleTimeParts(value: string): { hour: string; minute: string } {
  const normalized = normalizeScheduleTime(value, DEFAULT_SCHEDULE_TIME)
  const [hour = '09', minute = '00'] = normalized.split(':')
  return { hour, minute }
}

export function frequencyModeForCadence(cadence: ScheduledTaskCadence): ScheduleFrequencyMode {
  if (cadence === 'once') return 'once'
  if (cadence === 'custom') return 'interval'
  return 'periodic'
}

export function parseIntervalParts(text: string): { every: number; unit: IntervalUnit } {
  const match = text.match(/每\s*(\d+)?\s*(分钟|分|小时|钟头|时|天|日|周|星期|礼拜|月)/)
  if (!match) return { every: 30, unit: 'minute' }
  return { every: clampInt(Number(match[1] ?? 1), 1, 999), unit: UNIT_ALIASES[match[2] ?? '分钟'] ?? 'minute' }
}

export function parseWeeklyDay(text: string, options: WeekdayOption[] = weekdayOptions): number {
  const hit = options.find((item) => text.includes(item.label))
  return hit?.value ?? 1
}

export function parseMonthlyDay(text: string): number {
  const match = text.match(/(\d{1,2})\s*(?:号|日)/)
  return clampInt(Number(match?.[1] ?? 1), 1, 31)
}

export function formatDateInput(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function applyScheduleToForm(
  form: ScheduledTaskFormLike,
  cadence: ScheduledTaskCadence,
  scheduleText: string,
  nextRunAt?: number | null
): void {
  form.frequencyMode = frequencyModeForCadence(cadence)
  form.cadence = periodicCadences.includes(cadence) ? cadence : 'daily'
  form.scheduleText = cadence === 'custom'
    ? DEFAULT_SCHEDULE_TIME
    : normalizeScheduleTime(scheduleText, DEFAULT_SCHEDULE_TIME)
  form.onceDate = formatDateInput(nextRunAt ?? Date.now())

  if (cadence === 'custom') {
    const interval = parseIntervalParts(scheduleText)
    form.intervalEvery = interval.every
    form.intervalUnit = interval.unit
  }
  if (cadence === 'weekly') form.weeklyDay = parseWeeklyDay(scheduleText)
  if (cadence === 'monthly') form.monthlyDay = parseMonthlyDay(scheduleText)
}

export function scheduleTextForSubmit(form: ScheduledTaskFormLike): string {
  if (form.frequencyMode === 'interval') {
    return `每${clampInt(form.intervalEvery, 1, 999)}${UNIT_LABELS[form.intervalUnit]}`
  }

  const time = normalizeScheduleTime(form.scheduleText, DEFAULT_SCHEDULE_TIME)
  if (form.frequencyMode === 'once') return `${form.onceDate || formatDateInput(Date.now())} ${time}`
  if (form.cadence === 'workdays') return `工作日 ${time}`
  if (form.cadence === 'weekly') return `${weekdayOptions.find((item) => item.value === form.weeklyDay)?.label ?? '周一'} ${time}`
  if (form.cadence === 'monthly') return `${clampInt(form.monthlyDay, 1, 31)}号 ${time}`
  return `每天 ${time}`
}

export function cadenceForSubmit(form: ScheduledTaskFormLike): ScheduledTaskCadence {
  if (form.frequencyMode === 'interval') return 'custom'
  if (form.frequencyMode === 'once') return 'once'
  return periodicCadences.includes(form.cadence) ? form.cadence : 'daily'
}

export function onceNextRunAt(form: ScheduledTaskFormLike): number | null | undefined {
  if (form.frequencyMode !== 'once') return undefined
  const time = normalizeScheduleTime(form.scheduleText, DEFAULT_SCHEDULE_TIME)
  const date = form.onceDate || formatDateInput(Date.now())
  const ms = new Date(`${date}T${time}:00`).getTime()
  return Number.isFinite(ms) ? ms : Date.now() + 60 * 60 * 1000
}

