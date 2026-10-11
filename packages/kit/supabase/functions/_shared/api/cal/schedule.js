/*
 * One of a host's sets of hours (provider_schedules + provider_overrides) as cal.com's schedule (API v2, 2024-06-11) — a
 * host keeps any number, one of them theirs by default, which is cal.com's shape too. The kit keeps `weekly` as
 * { '1': [['09:00','12:00']], … } (ISO weekday 1–7, see schedulers/times.js) and an override as a day with ranges (null: off).
 */
import { eventTypeId } from './event-type.js'
const DAYS = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' }
export function scheduleOf(host, hours) {
  const availability = []
  const byRange = new Map()
  for (const [d, ranges] of Object.entries((hours && hours.weekly) || {})) for (const r of ranges || []) { const k = r[0] + '-' + r[1]; if (!byRange.has(k)) byRange.set(k, { days: [], startTime: r[0], endTime: r[1] }); byRange.get(k).days.push(DAYS[d] || d) }
  for (const v of byRange.values()) availability.push(v)
  const overrides = []
  for (const o of (hours && hours.overrides) || []) { const ranges = Array.isArray(o.ranges) ? o.ranges : []; if (!ranges.length) overrides.push({ date: o.day, startTime: '00:00', endTime: '00:00' }); else for (const r of ranges) overrides.push({ date: o.day, startTime: r[0], endTime: r[1] }) }
  /* the set's own id where it has one, so a client can ask for it by id; the host's where a caller
     handed hours that are not a row (a type's declared defaults) */
  const id = (hours && hours.id) ? eventTypeId('schedule:' + hours.id) : eventTypeId('user:' + (host.email || host.id))
  return {
    id, ownerId: eventTypeId('user:' + (host.email || host.id)),
    name: (hours && hours.name) || ((host.name || host.email || 'Working hours') + ' — hours'),
    timeZone: (hours && hours.timezone) || 'UTC', availability,
    isDefault: hours ? hours.is_default !== false : true,
    overrides,
    metadata: {
      beforeBufferMinutes: (hours && hours.buffer_before) || 0,
      afterBufferMinutes: (hours && hours.buffer_after) || 0,
      noticeHours: (hours && hours.notice_hours) || 0,
      maxPerDay: (hours && hours.max_per_day) || 0,
      maxPerWeek: (hours && hours.max_per_week) || 0,
    },
  }
}
