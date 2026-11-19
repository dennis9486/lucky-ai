import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCHEDULE_TIME,
  applyScheduleToForm,
  cadenceForSubmit,
  normalizeScheduleTime,
  onceNextRunAt,
  scheduleTextForSubmit,
  type ScheduledTaskFormLike
} from './scheduled-task-form.js'

function form(over: Partial<ScheduledTaskFormLike> = {}): ScheduledTaskFormLike {
  return {
    frequencyMode: 'periodic',
    cadence: 'daily',
    scheduleText: DEFAULT_SCHEDULE_TIME,
    intervalEvery: 30,
    intervalUnit: 'minute',
    weeklyDay: 1,
    monthlyDay: 1,
    onceDate: '2026-07-03',
    ...over
  }
}

describe('scheduled task form helpers', () => {
  it('normalizes typed schedule times', () => {
    expect(normalizeScheduleTime('9:05', DEFAULT_SCHEDULE_TIME)).toBe('09:05')
    expect(normalizeScheduleTime('1730', DEFAULT_SCHEDULE_TIME)).toBe('17:30')
    expect(normalizeScheduleTime('nope', DEFAULT_SCHEDULE_TIME)).toBe(DEFAULT_SCHEDULE_TIME)
  })

  it('formats periodic schedules consistently', () => {
    expect(scheduleTextForSubmit(form({ cadence: 'daily', scheduleText: '8:00' }))).toBe('每天 08:00')
    expect(scheduleTextForSubmit(form({ cadence: 'workdays', scheduleText: '17:00' }))).toBe('工作日 17:00')
    expect(scheduleTextForSubmit(form({ cadence: 'weekly', weeklyDay: 5, scheduleText: '0900' }))).toBe('周五 09:00')
    expect(scheduleTextForSubmit(form({ cadence: 'monthly', monthlyDay: 32, scheduleText: '12:30' }))).toBe('31号 12:30')
  })

  it('maps frequency mode to cadence and next run fields', () => {
    expect(cadenceForSubmit(form({ frequencyMode: 'interval' }))).toBe('custom')
    expect(scheduleTextForSubmit(form({ frequencyMode: 'interval', intervalEvery: 0, intervalUnit: 'hour' }))).toBe('每1小时')
    expect(cadenceForSubmit(form({ frequencyMode: 'once' }))).toBe('once')
    expect(onceNextRunAt(form({ frequencyMode: 'once', onceDate: '2026-07-03', scheduleText: '06:15' })))
      .toBe(new Date('2026-07-03T06:15:00').getTime())
  })

  it('hydrates existing task schedules into the edit form shape', () => {
    const target = form()
    applyScheduleToForm(target, 'weekly', '周日 19:45', new Date('2026-07-05T19:45:00').getTime())
    expect(target.frequencyMode).toBe('periodic')
    expect(target.cadence).toBe('weekly')
    expect(target.weeklyDay).toBe(0)
    expect(target.scheduleText).toBe('19:45')
  })
})

