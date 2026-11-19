import { describe, expect, it } from 'vitest'
import {
  computeNextRunAt,
  parseDayOfMonth,
  parseIntervalMs,
  parseTime,
  parseWeekday,
  zonedParts,
  zonedWallTimeToUtc
} from './scheduled-task-schedule.js'

const SHANGHAI = 'Asia/Shanghai' // UTC+8 全年无 DST
const NY = 'America/New_York'

describe('parseTime', () => {
  it('parses HH:MM with ascii and fullwidth colon', () => {
    expect(parseTime('工作日 8:30')).toEqual({ hour: 8, minute: 30 })
    expect(parseTime('每天 09：05')).toEqual({ hour: 9, minute: 5 })
  })
  it('parses hour-only Chinese/English forms', () => {
    expect(parseTime('每天8点')).toEqual({ hour: 8, minute: 0 })
    expect(parseTime('at 7h')).toEqual({ hour: 7, minute: 0 })
  })
  it('falls back to 09:00 and clamps out-of-range', () => {
    expect(parseTime('no time here')).toEqual({ hour: 9, minute: 0 })
    expect(parseTime('99:99')).toEqual({ hour: 23, minute: 59 })
  })
})

describe('parseWeekday', () => {
  it('recognizes cn/en weekdays, null when absent', () => {
    expect(parseWeekday('周五 9:00')).toBe(5)
    expect(parseWeekday('every Monday')).toBe(1)
    expect(parseWeekday('星期日')).toBe(0)
    expect(parseWeekday('no weekday')).toBeNull()
  })
})

describe('parseDayOfMonth / parseIntervalMs', () => {
  it('parses day-of-month', () => {
    expect(parseDayOfMonth('每月15号')).toBe(15)
    expect(parseDayOfMonth('the 1st')).toBe(1)
    expect(parseDayOfMonth('nope')).toBeNull()
  })
  it('parses interval expressions', () => {
    expect(parseIntervalMs('每30分钟')).toBe(30 * 60_000)
    expect(parseIntervalMs('每 2 小时')).toBe(2 * 3_600_000)
    expect(parseIntervalMs('every 3 days')).toBe(3 * 86_400_000)
    expect(parseIntervalMs('每小时')).toBe(3_600_000)
    expect(parseIntervalMs('no interval')).toBeNull()
  })
})

describe('zoned conversion is timezone-aware', () => {
  it('round-trips a wall time through its zone', () => {
    // 2026-03-02 08:00 in Shanghai == 2026-03-02 00:00 UTC
    const utc = zonedWallTimeToUtc(2026, 3, 2, 8, 0, SHANGHAI)
    expect(new Date(utc).toISOString()).toBe('2026-03-02T00:00:00.000Z')
    const parts = zonedParts(utc, SHANGHAI)
    expect(parts).toMatchObject({ year: 2026, month: 3, day: 2, hour: 8, minute: 0 })
  })
  it('honors a different timezone than the host', () => {
    // 08:00 New York (EST, UTC-5 on this date) == 13:00 UTC
    const utc = zonedWallTimeToUtc(2026, 1, 15, 8, 0, NY)
    expect(new Date(utc).toISOString()).toBe('2026-01-15T13:00:00.000Z')
  })
})

describe('computeNextRunAt', () => {
  it('daily picks the next occurrence strictly after now, in the task tz', () => {
    // now = 2026-03-02 09:00 Shanghai; daily 08:00 -> next day 08:00 Shanghai
    const now = zonedWallTimeToUtc(2026, 3, 2, 9, 0, SHANGHAI)
    const next = computeNextRunAt('daily', '每天 8:00', now, SHANGHAI)!
    expect(zonedParts(next, SHANGHAI)).toMatchObject({ month: 3, day: 3, hour: 8, minute: 0 })
  })

  it('daily later today when the time has not passed yet', () => {
    const now = zonedWallTimeToUtc(2026, 3, 2, 6, 0, SHANGHAI)
    const next = computeNextRunAt('daily', '8:00', now, SHANGHAI)!
    expect(zonedParts(next, SHANGHAI)).toMatchObject({ day: 2, hour: 8 })
  })

  it('workdays skips weekend', () => {
    // 2026-03-06 is a Friday in Shanghai; 09:00 daily already passed -> Monday 09:00
    const friday = zonedWallTimeToUtc(2026, 3, 6, 10, 0, SHANGHAI)
    const next = computeNextRunAt('workdays', '工作日 9:00', friday, SHANGHAI)!
    const p = zonedParts(next, SHANGHAI)
    expect(p.weekday).toBe(1) // Monday
    expect(p).toMatchObject({ day: 9, hour: 9 })
  })

  it('weekly lands on the requested weekday', () => {
    const now = zonedWallTimeToUtc(2026, 3, 2, 12, 0, SHANGHAI) // Monday
    const next = computeNextRunAt('weekly', '周五 9:00', now, SHANGHAI)!
    expect(zonedParts(next, SHANGHAI)).toMatchObject({ weekday: 5, hour: 9 })
  })

  it('weekly without an explicit weekday repeats on the anchor weekday', () => {
    const now = zonedWallTimeToUtc(2026, 3, 2, 12, 0, SHANGHAI) // Monday=1
    const next = computeNextRunAt('weekly', '9:00', now, SHANGHAI)!
    const p = zonedParts(next, SHANGHAI)
    expect(p.weekday).toBe(1)
    expect(p.day).toBe(9) // next Monday
  })

  it('monthly keeps the day-of-month and clamps short months', () => {
    // anchor 2026-01-31 10:00; monthly -> Feb has no 31 -> clamps to Feb 28
    const now = zonedWallTimeToUtc(2026, 1, 31, 12, 0, SHANGHAI)
    const next = computeNextRunAt('monthly', '10:00', now, SHANGHAI)!
    expect(zonedParts(next, SHANGHAI)).toMatchObject({ month: 2, day: 28, hour: 10 })
  })

  it('custom honors interval expressions', () => {
    const now = 1_700_000_000_000
    expect(computeNextRunAt('custom', '每30分钟', now, SHANGHAI)).toBe(now + 30 * 60_000)
  })

  it('custom with a bare time behaves daily', () => {
    const now = zonedWallTimeToUtc(2026, 3, 2, 9, 0, SHANGHAI)
    const next = computeNextRunAt('custom', '8:00', now, SHANGHAI)!
    expect(zonedParts(next, SHANGHAI)).toMatchObject({ day: 3, hour: 8 })
  })

  it('once never recurs', () => {
    expect(computeNextRunAt('once', '', Date.now(), SHANGHAI)).toBeNull()
  })

  it('always returns a time strictly in the future', () => {
    const now = Date.now()
    for (const cadence of ['daily', 'workdays', 'weekly', 'monthly'] as const) {
      const next = computeNextRunAt(cadence, '8:00', now, SHANGHAI)!
      expect(next).toBeGreaterThan(now)
    }
  })
})
