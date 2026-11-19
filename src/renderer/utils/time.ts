import { tGlobal } from '../i18n/index.js'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return tGlobal('time.justNow')
  if (minutes < 60) return tGlobal('time.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tGlobal('time.hours', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return tGlobal('time.days', { n: days })
  const months = Math.floor(days / 30)
  return tGlobal('time.months', { n: months })
}

/** 消息气泡：近期相对时间，较远则带日期 */
export function formatMessageTimestamp(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp
  const date = new Date(timestamp)
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

  if (diff < 60_000) return tGlobal('time.justNow')
  if (diff < 3_600_000) return tGlobal('time.minutesAgo', { n: Math.floor(diff / 60_000) })

  const today = new Date(now)
  if (isSameDay(date, today)) return tGlobal('time.today', { time })

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) return tGlobal('time.yesterday', { time })

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === today.getFullYear()) {
    return tGlobal('time.dateThisYear', { month, day, time })
  }
  return tGlobal('time.dateFull', { year: date.getFullYear(), month, day, time })
}
