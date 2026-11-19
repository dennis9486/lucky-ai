import { describe, expect, it } from 'vitest'
import { parseTimeInput, formatInZone, timeNow, timeDiff, timeAdd, TimeError } from './time.service.js'

describe('parseTimeInput', () => {
  it('parses ISO, epoch ms and epoch seconds', () => {
    expect(parseTimeInput('1970-01-01T00:00:00Z')).toBe(0)
    expect(parseTimeInput('2020-01-01T00:00:00Z')).toBe(1577836800000)
    expect(parseTimeInput(1577836800000)).toBe(1577836800000) // ms magnitude
    expect(parseTimeInput(1577836800)).toBe(1577836800000) // seconds magnitude -> normalized
  })
  it('throws on bad input', () => {
    expect(() => parseTimeInput('not a date')).toThrow(TimeError)
    expect(() => parseTimeInput(null)).toThrow(TimeError)
  })
})

describe('formatInZone', () => {
  it('is timezone-aware', () => {
    expect(formatInZone(0, 'UTC').formatted).toBe('1970-01-01 00:00:00')
    expect(formatInZone(0, 'Asia/Shanghai').formatted).toBe('1970-01-01 08:00:00') // UTC+8
  })
  it('rejects invalid timezone', () => {
    expect(() => formatInZone(0, 'Mars/Olympus')).toThrow(TimeError)
  })
})

describe('timeNow', () => {
  it('returns a coherent snapshot', () => {
    const now = timeNow('UTC')
    expect(typeof now.epochMs).toBe('number')
    expect(now.timeZone).toBe('UTC')
    expect(Date.parse(now.iso as string)).toBeCloseTo(now.epochMs as number, -3)
  })
})

describe('timeDiff / timeAdd', () => {
  it('computes differences', () => {
    // 用 ISO 字符串避免「秒/毫秒」量级歧义
    const diff = timeDiff('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')
    expect(diff.deltaDays).toBe(1)
    expect(diff.human).toBe('1d')
    expect(timeDiff('2020-01-02T00:00:00Z', '2020-01-01T00:00:00Z').human).toBe('-1d')
  })
  it('adds durations', () => {
    expect(timeAdd(0, 1, 'day').epochMs).toBe(86_400_000)
    expect(timeAdd(0, -2, 'hour').epochMs).toBe(-7_200_000)
    expect(() => timeAdd(0, 'x' as unknown as number, 'day')).toThrow(TimeError)
  })
})
