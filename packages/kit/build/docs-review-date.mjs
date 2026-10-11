function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function isReviewedForCurrentDate(reviewed, now = new Date(), timezoneOffset = now.getTimezoneOffset()) {
  const localNow = new Date(now.getTime() - timezoneOffset * 60_000)
  const today = dateKey(localNow)
  if (reviewed === today) return true
  if (timezoneOffset !== 0) return false
  const utcHour = now.getUTCHours()
  const day = 24 * 60 * 60 * 1000
  if (utcHour < 12 && reviewed === dateKey(new Date(localNow.getTime() - day))) return true
  return utcHour >= 10 && reviewed === dateKey(new Date(localNow.getTime() + day))
}
