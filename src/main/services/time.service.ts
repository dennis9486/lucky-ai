/**
 * time.service.ts — 时间工具（零依赖、纯函数、可单测）。
 *
 * 提供当前时间、时区格式化、时间差、时间加减四类操作。所有跨时区展示基于 Intl，
 * 内部一律以 UTC 毫秒（epoch）为准，避免宿主时区歧义。
 */

export class TimeError extends Error {}

export type TimeUnit = 'ms' | 'second' | 'minute' | 'hour' | 'day' | 'week'

const UNIT_MS: Record<TimeUnit, number> = {
  ms: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000
}

function safeTimeZone(tz?: string): string {
  const value = (tz ?? '').trim()
  if (!value) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    throw new TimeError(`无效时区：${tz}`)
  }
}

/** 把 ISO 字符串或 epoch（毫秒/秒）解析为 epoch 毫秒。 */
export function parseTimeInput(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    // 10 位约为秒级时间戳，13 位为毫秒级；据量级归一到毫秒
    return Math.abs(input) < 1e12 ? Math.round(input * 1000) : Math.round(input)
  }
  if (typeof input === 'string' && input.trim()) {
    const parsed = Date.parse(input.trim())
    if (Number.isNaN(parsed)) throw new TimeError(`无法解析时间：${input}`)
    return parsed
  }
  throw new TimeError('缺少有效的时间输入')
}

/** 在指定时区把 epoch 毫秒格式化为「YYYY-MM-DD HH:mm:ss」+ 星期。 */
export function formatInZone(epochMs: number, tz?: string): { formatted: string; weekday: string; timeZone: string } {
  const timeZone = safeTimeZone(tz)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short'
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hour = parts.hour === '24' ? '00' : parts.hour
  return {
    formatted: `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday ?? '',
    timeZone
  }
}

export function timeNow(tz?: string): Record<string, unknown> {
  const epochMs = Date.now()
  const zoned = formatInZone(epochMs, tz)
  return {
    epochMs,
    epochSeconds: Math.floor(epochMs / 1000),
    iso: new Date(epochMs).toISOString(),
    timeZone: zoned.timeZone,
    localFormatted: zoned.formatted,
    weekday: zoned.weekday
  }
}

export function timeFormat(input: unknown, tz?: string): Record<string, unknown> {
  const epochMs = parseTimeInput(input)
  const zoned = formatInZone(epochMs, tz)
  return {
    epochMs,
    iso: new Date(epochMs).toISOString(),
    timeZone: zoned.timeZone,
    formatted: zoned.formatted,
    weekday: zoned.weekday
  }
}

/** 人类可读的时长分解（正数）。 */
function humanizeDuration(ms: number): string {
  const abs = Math.abs(ms)
  const days = Math.floor(abs / UNIT_MS.day)
  const hours = Math.floor((abs % UNIT_MS.day) / UNIT_MS.hour)
  const minutes = Math.floor((abs % UNIT_MS.hour) / UNIT_MS.minute)
  const seconds = Math.floor((abs % UNIT_MS.minute) / UNIT_MS.second)
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (seconds || !parts.length) parts.push(`${seconds}s`)
  return parts.join(' ')
}

export function timeDiff(from: unknown, to: unknown): Record<string, unknown> {
  const fromMs = parseTimeInput(from)
  const toMs = parseTimeInput(to)
  const deltaMs = toMs - fromMs
  return {
    fromMs,
    toMs,
    deltaMs,
    deltaSeconds: deltaMs / 1000,
    deltaMinutes: deltaMs / UNIT_MS.minute,
    deltaHours: deltaMs / UNIT_MS.hour,
    deltaDays: deltaMs / UNIT_MS.day,
    human: `${deltaMs < 0 ? '-' : ''}${humanizeDuration(deltaMs)}`
  }
}

export function timeAdd(base: unknown, amount: unknown, unit: TimeUnit, tz?: string): Record<string, unknown> {
  const baseMs = parseTimeInput(base)
  const n = Number(amount)
  if (!Number.isFinite(n)) throw new TimeError(`amount 必须是数字，收到 ${String(amount)}`)
  if (!(unit in UNIT_MS)) throw new TimeError(`无效单位：${unit}`)
  const resultMs = baseMs + n * UNIT_MS[unit]
  const zoned = formatInZone(resultMs, tz)
  return {
    epochMs: resultMs,
    iso: new Date(resultMs).toISOString(),
    timeZone: zoned.timeZone,
    formatted: zoned.formatted,
    weekday: zoned.weekday
  }
}
