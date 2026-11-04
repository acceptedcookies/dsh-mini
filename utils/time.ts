/** Format a timestamp for the session list. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0')
  return `${month}-${dayOfMonth}`
}

/** Format a clock time for message metadata. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * Date-aware message clock: `HH:mm` today, `M月D日 HH:mm` earlier this year,
 * `YYYY年M月D日 HH:mm` across years.
 */
export function formatMessageClock(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const current = new Date(now)
  const clock = formatClock(timestamp)
  if (
    date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate()
  ) {
    return clock
  }
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === current.getFullYear()) {
    return `${month}月${day}日 ${clock}`
  }
  return `${date.getFullYear()}年${month}月${day}日 ${clock}`
}
