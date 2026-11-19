import type { ScheduledTaskCadence } from '../../shared/types/scheduled-task.js'

/**
 * 已安排任务的排期计算 —— 纯函数、时区感知、可单测。
 *
 * 关键修复（相对旧实现）：
 * - 旧实现用 `new Date()/setHours()` 全程按宿主机本地时区算，存储的 `timezone` 字段从不参与运算。
 *   本模块所有“墙上时间”（HH:MM、星期、号数）都在任务自身的 IANA 时区内解释，再换算成 UTC 毫秒。
 * - `custom` 旧实现永远 `now+24h`，忽略 scheduleText；这里支持“每N分钟/小时/天/周”及英文 every N unit，
 *   也支持只写 HH:MM 时按每日处理。
 * - `weekly` 解析不到星期时不再硬编码周五，而是回退到锚点时刻所在的星期。
 * - `monthly` 保留锚点的“号数 + HH:MM”，跨月时对短月做末日钳制（如 31 号→2 月末）。
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
  weekday: number // 0=Sun .. 6=Sat
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
}

function safeTimeZone(timeZone: string | undefined): string {
  const tz = (timeZone ?? '').trim()
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** 某 UTC 瞬时在指定时区的偏移（分钟，local - utc）。 */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const map: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = Number(part.value)
  }
  // hour 在 00:00 处可能被格式化成 24，规范化为 0
  const hour = map.hour === 24 ? 0 : map.hour
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return (asUtc - utcMs) / MINUTE
}

/** 读取某 UTC 瞬时在指定时区下的墙上时间字段。 */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const tz = safeTimeZone(timeZone)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const map: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour)
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[(map.weekday ?? 'Sun').slice(0, 3).toLowerCase()] ?? 0
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 把某时区下的墙上时间 (Y-M-D H:M) 换算为 UTC 毫秒。
 * 对 DST 边界做一次偏移修正；day 超过当月天数时钳制到末日。
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const tz = safeTimeZone(timeZone)
  const clampedDay = Math.min(Math.max(day, 1), daysInMonth(year, month))
  const naiveUtc = Date.UTC(year, month - 1, clampedDay, hour, minute, 0)
  const offset1 = tzOffsetMinutes(naiveUtc, tz)
  let utc = naiveUtc - offset1 * MINUTE
  const offset2 = tzOffsetMinutes(utc, tz)
  if (offset2 !== offset1) utc = naiveUtc - offset2 * MINUTE
  return utc
}

export function parseTime(text: string): { hour: number; minute: number } {
  const match = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (!match) {
    // 仅写了整点小时，如 “8 点 / 8点 / at 8”
    const hourOnly = text.match(/(?:^|\D)(\d{1,2})\s*(?:点|时|h|H)(?!\d)/)
    if (hourOnly) return { hour: clamp(Number(hourOnly[1]), 0, 23), minute: 0 }
    return { hour: 9, minute: 0 }
  }
  return { hour: clamp(Number(match[1]), 0, 23), minute: clamp(Number(match[2]), 0, 59) }
}

export function parseWeekday(text: string): number | null {
  const lower = text.toLowerCase()
  const pairs: Array<[RegExp, number]> = [
    [/周日|周天|星期日|星期天|礼拜日|礼拜天|sunday|sun/, 0],
    [/周一|星期一|礼拜一|monday|mon/, 1],
    [/周二|星期二|礼拜二|tuesday|tue/, 2],
    [/周三|星期三|礼拜三|wednesday|wed/, 3],
    [/周四|星期四|礼拜四|thursday|thu/, 4],
    [/周五|星期五|礼拜五|friday|fri/, 5],
    [/周六|星期六|礼拜六|saturday|sat/, 6]
  ]
  return pairs.find(([pattern]) => pattern.test(lower))?.[1] ?? null
}

/** 解析“号数 / 日”，如 “每月15号 / 15日 / day 15 / the 1st”。 */
export function parseDayOfMonth(text: string): number | null {
  const cn = text.match(/(\d{1,2})\s*(?:号|日)/)
  if (cn) return clamp(Number(cn[1]), 1, 31)
  const en = text.match(/(?:day|the)\s*(\d{1,2})/i)
  if (en) return clamp(Number(en[1]), 1, 31)
  return null
}

/** 解析 custom 的间隔表达式，返回毫秒；解析不到返回 null。 */
export function parseIntervalMs(text: string): number | null {
  const cn = text.match(/每\s*(\d+)?\s*(分钟|分|小时|钟头|时|天|日|周|星期|礼拜|月)/)
  if (cn) {
    const n = cn[1] ? Number(cn[1]) : 1
    return n * unitToMs(cn[2])
  }
  const en = text.match(/every\s*(\d+)?\s*(minute|min|hour|hr|day|week|month)s?/i)
  if (en) {
    const n = en[1] ? Number(en[1]) : 1
    return n * unitToMs(en[2].toLowerCase())
  }
  return null
}

function unitToMs(unit: string): number {
  switch (unit) {
    case '分钟':
    case '分':
    case 'minute':
    case 'min':
      return MINUTE
    case '小时':
    case '钟头':
    case '时':
    case 'hour':
    case 'hr':
      return HOUR
    case '天':
    case '日':
    case 'day':
      return DAY
    case '周':
    case '星期':
    case '礼拜':
    case 'week':
      return 7 * DAY
    case '月':
    case 'month':
      return 30 * DAY
    default:
      return DAY
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 计算严格晚于 `from` 的下一次运行时间（UTC 毫秒）。
 * `once` 不重复，返回 null（首跑时间由 service 在创建时设定）。
 */
export function computeNextRunAt(
  cadence: ScheduledTaskCadence,
  scheduleText: string,
  from: number,
  timeZone: string
): number | null {
  const tz = safeTimeZone(timeZone)
  const text = scheduleText ?? ''

  if (cadence === 'once') return null

  if (cadence === 'custom') {
    const interval = parseIntervalMs(text)
    if (interval && interval > 0) return from + interval
    // 退化为“每日 HH:MM”（若写了时间），否则 24h 后
    if (/\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*(?:点|时)/.test(text)) {
      return nextDailyAt(text, from, tz, () => true)
    }
    return from + DAY
  }

  if (cadence === 'daily') {
    return nextDailyAt(text, from, tz, () => true)
  }

  if (cadence === 'workdays') {
    return nextDailyAt(text, from, tz, (weekday) => weekday >= 1 && weekday <= 5)
  }

  if (cadence === 'weekly') {
    const anchorWeekday = parseWeekday(text) ?? zonedParts(from, tz).weekday
    return nextDailyAt(text, from, tz, (weekday) => weekday === anchorWeekday)
  }

  if (cadence === 'monthly') {
    const { hour, minute } = parseTime(text)
    const anchor = zonedParts(from, tz)
    const targetDay = parseDayOfMonth(text) ?? anchor.day
    // 本月候选
    let year = anchor.year
    let month = anchor.month
    let candidate = zonedWallTimeToUtc(year, month, targetDay, hour, minute, tz)
    if (candidate <= from) {
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
      candidate = zonedWallTimeToUtc(year, month, targetDay, hour, minute, tz)
    }
    return candidate
  }

  return from + DAY
}

/**
 * 从 `from` 起向后逐日扫描，找到第一个满足 `dayMatches(weekday)` 且
 * 其墙上 HH:MM 时刻严格晚于 `from` 的 UTC 毫秒。最多扫描 370 天兜底。
 */
function nextDailyAt(
  scheduleText: string,
  from: number,
  timeZone: string,
  dayMatches: (weekday: number) => boolean
): number {
  const { hour, minute } = parseTime(scheduleText)
  const start = zonedParts(from, timeZone)
  for (let offset = 0; offset <= 370; offset++) {
    // 通过给“当天 12:00”加偏移天数来安全跨月/跨年，再读取该天的日期字段
    const probe = zonedWallTimeToUtc(start.year, start.month, start.day, 12, 0, timeZone) + offset * DAY
    const day = zonedParts(probe, timeZone)
    if (!dayMatches(day.weekday)) continue
    const candidate = zonedWallTimeToUtc(day.year, day.month, day.day, hour, minute, timeZone)
    if (candidate > from) return candidate
  }
  // 理论不可达
  return from + DAY
}
