/*
 * The arithmetic of a host's hours — pure, no environment, shared by the native scheduler (Deno)
 * and the kit's test (node). A host's week is `{ "1": [["09:00","12:00"]], … }` (ISO weekday 1–7 →
 * the day's ranges in the host's zone; a day absent is off); an override is `{ day: 'YYYY-MM-DD',
 * ranges: null | [...] }` (null: the day off; ranges: instead of the week's). Everything here is
 * wall time in one zone turned into instants with Intl alone — no library, and no offset guessed:
 * a wall time is resolved by asking the zone what it says at a nearby instant, twice, so a day that
 * changes its clocks still lands.
 */

const pad = (n) => String(n).padStart(2, '0')
const parts = (ms, tz) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const o = {}; for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o
}
/* the zone's offset from UTC at an instant, in ms */
export function offsetAt(ms, tz) {
  const p = parts(ms, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}
/* a wall time ('YYYY-MM-DD', 'HH:MM') in a zone → the instant (ms) */
export function wallToUtc(day, hhmm, tz) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number)
  const naive = Date.UTC(y, m - 1, d, h, mi)
  let ms = naive - offsetAt(naive, tz)
  ms = naive - offsetAt(ms, tz)
  return ms
}
/* the day ('YYYY-MM-DD') and ISO weekday (1 Monday … 7 Sunday) an instant falls on in a zone */
export function dayOf(ms, tz) {
  const p = parts(ms, tz)
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`
  const w = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  return { day, weekday: w === 0 ? 7 : w }
}
/* the days from one to another inclusive ('YYYY-MM-DD', at most `cap` — a fence against an
   unbounded scan, not a rule about how far ahead anything may be: a caller that means a longer
   window says so, which is what a run of six monthly sessions needs) */
export function days(from, to, cap = 62) {
  const out = []
  let t = Date.UTC(...from.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)))
  const end = Date.UTC(...to.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)))
  while (t <= end && out.length < cap) { const d = new Date(t); out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`); t += 864e5 }
  return out
}
const validRange = (r) => Array.isArray(r) && r.length === 2 && /^\d{2}:\d{2}$/.test(r[0]) && /^\d{2}:\d{2}$/.test(r[1]) && r[0] < r[1]
/* a host's ranges on a day: the override's, else the week's; [] when off */
export function rangesOn(day, weekday, weekly, overrides) {
  const o = (overrides || []).find((x) => x.day === day)
  if (o) return o.ranges === null || o.ranges === undefined ? [] : o.ranges.filter(validRange)
  return ((weekly || {})[String(weekday)] || []).filter(validRange)
}

/*
 * The open starts of one host for one type between two days (inclusive), as instants (ms):
 *   hours   { timezone, weekly, overrides, buffer_before, buffer_after, notice_hours, max_per_day,
 *             max_per_week }
 *   type    { duration (minutes), step (minutes, 15 by default), offset (minutes into each range the
 *             grid begins), bufferBefore, bufferAfter, notice }
 *   busy    [{ start, end }] — the host's bookings as ms (every status that holds a time)
 *   now     ms
 * A start is kept when its whole session ends inside a range, it is at least the notice ahead, it
 * does not overlap a busy interval widened by the breathing room on both sides, and the day holds
 * fewer than max_per_day busy intervals and its week fewer than max_per_week (0: no cap). The step is the grid a start sits on from the
 * range's beginning.
 */
export function openStarts({ hours, type, busy = [], from, to, now, span = 62 }) {
  const tz = hours.timezone || 'UTC'
  const dur = Math.max(5, Number(type.duration) || 60) * 6e4
  const step = Math.max(5, Number(type.step) || 15) * 6e4
  /* WHERE THE GRID BEGINS inside a range. A type that wants its times at a quarter past says so
     once here rather than having every host write 09:15 in their week. */
  const offset = Math.max(0, Number(type.offset) || 0) * 6e4
  /* BREATHING ROOM IS TWO NUMBERS. One meant the same either side, which is not how anybody works:
     ten minutes to write a note after a call, none needed before it. Where both the set of hours and
     the type say a number, the WIDER holds — a type asking for more room than the host keeps gets it,
     and a type asking for less never takes the host's away. */
  const bBefore = Math.max(0, Number(hours.buffer_before) || 0, Number((type || {}).bufferBefore) || 0) * 6e4
  const bAfter = Math.max(0, Number(hours.buffer_after) || 0, Number((type || {}).bufferAfter) || 0) * 6e4
  /* and the LONGER notice holds, for the same reason */
  const notBefore = now + Math.max(0, Number(hours.notice_hours) || 0, Number((type || {}).notice) || 0) * 36e5
  const cap = Math.max(0, Number(hours.max_per_day) || 0)
  /* AND THE WEEK'S, which is the cap people actually feel: four calls in a day is a hard day, and
     four a week is a practice. Counted over the same busy list, by the Monday the day falls in. */
  const weekCap = Math.max(0, Number(hours.max_per_week) || 0)
  const mondayOf = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
  const perWeek = {}
  if (weekCap) for (const b2 of busy) { const k = mondayOf(dayOf(b2.start, tz).day); perWeek[k] = (perWeek[k] || 0) + 1 }
  const out = []
  for (const day of days(from, to, span)) {
    const noon = wallToUtc(day, '12:00', tz)
    const { weekday } = dayOf(noon, tz)
    const ranges = rangesOn(day, weekday, hours.weekly, hours.overrides)
    if (!ranges.length) continue
    if (cap) {
      const dayStart = wallToUtc(day, '00:00', tz), dayEnd = dayStart + 36e5 * 36
      const onDay = busy.filter((b) => b.start >= dayStart && b.start < dayEnd && dayOf(b.start, tz).day === day).length
      if (onDay >= cap) continue
    }
    if (weekCap && (perWeek[mondayOf(day)] || 0) >= weekCap) continue
    for (const [a, z] of ranges) {
      const rs = wallToUtc(day, a, tz), re = wallToUtc(day, z, tz)
      for (let s = rs + offset; s + dur <= re; s += step) {
        if (s < notBefore) continue
        const e = s + dur
        /* a busy interval is widened by the room owed AFTER it and the room owed BEFORE the next:
           a call ending at ten with ten minutes after it takes the start at ten past, not the one at ten */
        if (busy.some((b) => s < b.end + bAfter && e > b.start - bBefore)) continue
        out.push(s)
      }
    }
  }
  return out
}
/* the starts grouped by the day they fall on in the reader's zone: { 'YYYY-MM-DD': [iso…] } */
export function byDay(starts, tz) {
  const out = {}
  for (const s of starts) { const { day } = dayOf(s, tz); (out[day] ||= []).push(new Date(s).toISOString()) }
  return out
}

/*
 * WHOSE TURN IT IS, when several hosts give the same type and one of them takes each booking.
 *
 * This is cal.com's ladder and not an invention: among the hosts free at that time, the highest
 * PRIORITY wins; among those, the one furthest below their WEIGHT; among those, the one booked
 * LEAST RECENTLY; and if two are still level, one at random. Nothing else is consulted — not who is
 * cheapest, not who answers fastest — because a rota people cannot predict is a rota they distrust.
 *
 *   hosts  [{ id, priority = 2, weight = 100 }]   priority 0 lowest … 4 highest; weight a percentage
 *   state  { [id]: { count, last, credit } }      count: CONFIRMED bookings; last: ms of the latest;
 *                                                 credit: what they were given on joining
 *   free   the ids free at the time in question (every host when not given)
 *
 * "Furthest below their weight" is (count + credit) ÷ weight, lowest first — which is what a
 * percentage means: a host at 200% with twelve bookings stands level with one at 100% with six.
 *
 * Only CONFIRMED bookings count, so a cancelled booking leaves the host's turn exactly where it was.
 * The caller decides what confirmed means and hands the counts in; this function never asks.
 */
export function share(hosts, state = {}, free = null, rand = Math.random) {
  const pool = (hosts || []).filter((h) => h && h.id && (!free || free.includes(h.id)))
  if (!pool.length) return null
  const of = (h) => state[h.id] || {}
  const pri = (h) => Number(h.priority ?? 2)
  const load = (h) => { const s = of(h); return ((Number(s.count) || 0) + (Number(s.credit) || 0)) / Math.max(1, Number(h.weight ?? 100)) }
  /* a host who has never been booked is the oldest turn there is, not the newest */
  const last = (h) => { const v = Number(of(h).last); return Number.isFinite(v) ? v : -Infinity }
  const top = Math.max(...pool.map(pri))
  let rung = pool.filter((h) => pri(h) === top)
  if (rung.length > 1) { const lo = Math.min(...rung.map(load)); rung = rung.filter((h) => Math.abs(load(h) - lo) < 1e-9) }
  if (rung.length > 1) { const old = Math.min(...rung.map(last)); rung = rung.filter((h) => last(h) === old) }
  return rung.length === 1 ? rung[0] : rung[Math.floor(rand() * rung.length) % rung.length]
}

/*
 * WHAT A HOST IS CREDITED WITH ON JOINING a rota that has been running. Without it they would take
 * every booking until they caught up with everybody else, which is not a welcome. It is their share
 * of what the rota has done so far, at their own weight — a fact about WHEN THEY JOINED, so it is
 * written down once and never recomputed: recomputing it later would move it.
 */
export function joiningCredit(hosts, state = {}, weight = 100) {
  const counts = (hosts || []).reduce((n, h) => n + (Number((state[h.id] || {}).count) || 0) + (Number((state[h.id] || {}).credit) || 0), 0)
  const weights = (hosts || []).reduce((n, h) => n + Math.max(1, Number(h.weight ?? 100)), 0)
  if (!weights) return 0
  return Math.round((counts / weights) * Math.max(1, Number(weight)))
}

/*
 * WHAT A TYPE OFFERS, from every host's hours — the one place the rules meet, and pure, so the
 * booker, the API and the booking itself cannot disagree about what is open.
 *
 *   type   { duration, step, offset, windowDays, windowFrom, windowTo, assign, fixed,
 *            limits: { day, week, month, year, minutesDay, minutesWeek } }
 *   hosts  [{ id, hours, busy, away, priority, weight }]   each with THEIR OWN hours, bookings and away days
 *   taken  [{ start, end }]  what the TYPE already holds, for its own limits (every host's)
 *
 * In this order, each step a function of the last:
 *
 *   1. per host, their candidate starts (openStarts, against the hours the type asked them for),
 *      less the days they are away
 *   2. the window it will take bookings in (the grid is the type's own, applied in step 1)
 *   3. ASSIGNMENT, which is the only place the kinds differ:
 *        one · round-robin   the UNION: anybody free means the time is open
 *        collective          the INTERSECTION: everybody must be free, because everybody comes
 *        round-robin + fixed the union of the rotating hosts, intersected with every fixed one
 *   4. the type's own limits, counted over what it already holds
 *   5. the answer: each start with the hosts free at it, so booking need not ask a second time
 */
const startOfDay = (ms, tz) => wallToUtc(dayOf(ms, tz).day, '00:00', tz)
const weekKey = (ms, tz) => { const { day } = dayOf(ms, tz); const d = new Date(day + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10) }
const monthKey = (ms, tz) => dayOf(ms, tz).day.slice(0, 7)
const yearKey = (ms, tz) => dayOf(ms, tz).day.slice(0, 4)

/*
 * WHICH OF THE TYPE'S CAPS A TIME IS PAST, or null — so a booking that arrives a moment too late can
 * be told WHICH limit it met rather than "that time has gone". A reader who is refused without a
 * reason assumes the site is broken; a reader told "the week is full" books the week after.
 */
export function overLimit(type = {}, start, taken = [], tz = 'UTC') {
  const L = type.limits || {}
  const dur = Math.max(5, Number(type.duration) || 60)
  const keys = { day: dayOf(start, tz).day, week: weekKey(start, tz), month: monthKey(start, tz), year: yearKey(start, tz) }
  const held = { day: 0, week: 0, month: 0, year: 0, minutesDay: 0, minutesWeek: 0 }
  for (const b of taken) {
    const mins = Math.max(0, (b.end - b.start) / 6e4)
    if (dayOf(b.start, tz).day === keys.day) { held.day++; held.minutesDay += mins }
    if (weekKey(b.start, tz) === keys.week) { held.week++; held.minutesWeek += mins }
    if (monthKey(b.start, tz) === keys.month) held.month++
    if (yearKey(b.start, tz) === keys.year) held.year++
  }
  for (const k of ['day', 'week', 'month', 'year']) if (L[k] && held[k] >= L[k]) return { span: k, limit: L[k], held: held[k] }
  for (const k of ['minutesDay', 'minutesWeek']) if (L[k] && held[k] + dur > L[k]) return { span: k, limit: L[k], held: held[k] }
  return null
}

export function offer({ type = {}, hosts = [], taken = [], from, to, now = Date.now(), tz = 'UTC', span = 62 }) {
  const dur = Math.max(5, Number(type.duration) || 60)
  /* 1 — every host's own candidate starts, on the type's own grid (step and offset) */
  const byStart = new Map()
  for (const h of hosts) {
    /* their AWAY days come off here — after their own hours, before the type's limits: a day
       somebody is away is not a day they keep, and a cap should not be spent on a day nobody could
       have booked anyway */
    const theirs = notAway(openStarts({ hours: h.hours || {}, type, busy: h.busy || [], from, to, now, span }), h.away || [], (h.hours || {}).timezone || tz)
    for (const s of theirs) {
      if (!byStart.has(s)) byStart.set(s, new Set())
      byStart.get(s).add(h.id)
    }
  }
  /* 2 — the window the type takes bookings in (its grid was applied in step 1) */
  const windowFrom = type.windowFrom ? wallToUtc(type.windowFrom, '00:00', tz) : null
  const windowTo = type.windowTo ? wallToUtc(type.windowTo, '00:00', tz) + 864e5 : null
  const rolling = Number(type.windowDays) > 0 ? now + Number(type.windowDays) * 864e5 : null
  /* 3 — assignment */
  const fixed = (type.fixed || []).filter((id) => hosts.some((h) => h.id === id))
  const rotating = hosts.filter((h) => !fixed.includes(h.id)).map((h) => h.id)
  const kind = String(type.assign || 'one')
  const admits = (ids) => {
    if (kind === 'collective') return hosts.every((h) => ids.has(h.id))
    /* every fixed host comes to every booking, so a time none of them keeps is no time at all */
    if (!fixed.every((id) => ids.has(id))) return false
    return rotating.length ? rotating.some((id) => ids.has(id)) : fixed.length > 0
  }
  let starts = [...byStart.keys()].sort((a, b) => a - b)
    .filter((s) => (!windowFrom || s >= windowFrom) && (!windowTo || s < windowTo) && (!rolling || s <= rolling) && admits(byStart.get(s)))
  /* 4 — the type's own limits, over what it already holds. A cap is reached, not approached: a day
     already at its count offers nothing more that day, whoever is free. */
  const L = type.limits || {}
  const held = { day: {}, week: {}, month: {}, year: {}, minutesDay: {}, minutesWeek: {} }
  for (const b of taken) {
    const mins = Math.max(0, (b.end - b.start) / 6e4)
    const d = dayOf(b.start, tz).day, w = weekKey(b.start, tz), m = monthKey(b.start, tz), y = yearKey(b.start, tz)
    held.day[d] = (held.day[d] || 0) + 1; held.week[w] = (held.week[w] || 0) + 1
    held.month[m] = (held.month[m] || 0) + 1; held.year[y] = (held.year[y] || 0) + 1
    held.minutesDay[d] = (held.minutesDay[d] || 0) + mins; held.minutesWeek[w] = (held.minutesWeek[w] || 0) + mins
  }
  const under = (s) => {
    const d = dayOf(s, tz).day, w = weekKey(s, tz), m = monthKey(s, tz), y = yearKey(s, tz)
    if (L.day && (held.day[d] || 0) >= L.day) return false
    if (L.week && (held.week[w] || 0) >= L.week) return false
    if (L.month && (held.month[m] || 0) >= L.month) return false
    if (L.year && (held.year[y] || 0) >= L.year) return false
    if (L.minutesDay && (held.minutesDay[d] || 0) + dur > L.minutesDay) return false
    if (L.minutesWeek && (held.minutesWeek[w] || 0) + dur > L.minutesWeek) return false
    return true
  }
  starts = starts.filter(under)
  /* 5 — and who is free at each, so the booking need not ask again */
  return starts.map((s) => ({ start: s, end: s + dur * 6e4, hosts: [...byStart.get(s)].filter((id) => kind === 'collective' || rotating.includes(id) || fixed.includes(id)) }))
}

/*
 * A RUN OF SESSIONS — the same time, so many weeks (or months, or years) apart. Pure, and shared by
 * the booker and the booking, because a run somebody is shown must be the run that is made.
 *
 * The dates walk in WALL TIME in the host's zone, not by adding milliseconds: a fortnightly session
 * at nine in the morning is at nine in the morning after the clocks change, and adding 14 × 864e5
 * would quietly move it an hour twice a year.
 */
export function runTimes(start, { count = 1, every = 'week' } = {}, tz = 'UTC') {
  const n = Math.max(1, Math.round(Number(count) || 1))
  const first = typeof start === 'number' ? start : Date.parse(start || '')
  if (!Number.isFinite(first)) return []
  const { day } = dayOf(first, tz)
  const p = parts(first, tz)
  const hhmm = `${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}`
  const [y, m, d] = day.split('-').map(Number)
  const out = []
  for (let i = 0; i < n; i++) {
    let dd
    if (every === 'week') { const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() + i * 7); dd = x }
    else if (every === 'month') { const x = new Date(Date.UTC(y, m - 1 + i, 1)); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(d, last)); dd = x }
    else { const x = new Date(Date.UTC(y + i, m - 1, 1)); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(d, last)); dd = x }
    out.push(wallToUtc(`${dd.getUTCFullYear()}-${pad(dd.getUTCMonth() + 1)}-${pad(dd.getUTCDate())}`, hhmm, tz))
  }
  return out
}

/*
 * AWAY. A stretch of days somebody is not available for, subtracted from the starts they would
 * otherwise offer — pure, so the booker and the booking agree about which days are gone.
 *
 * A stretch is whole days in the HOST'S zone: "away from the 3rd to the 10th" means those days as
 * they live them, not a window of hours that begins at midnight somewhere else.
 */
export function notAway(starts, away = [], tz = 'UTC') {
  if (!away.length) return starts
  const shut = new Set()
  for (const a of away) for (const d of days(a.from, a.to, 400)) shut.add(d)
  return starts.filter((s) => !shut.has(dayOf(s, tz).day))
}
