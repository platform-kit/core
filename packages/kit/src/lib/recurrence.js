/*
 * WHEN SOMETHING HAPPENS AGAIN — the one rule for a thing that repeats, shared by an event a
 * community attends and the hours a booking type is open.
 *
 * It is written as FIELDS and never as a grammar. An iCalendar RRULE
 * (`FREQ=MONTHLY;BYDAY=3FR;UNTIL=…`) is a syntax to learn, to mistype and to explain, and this
 * project does not ask people to type structured text. So a repeat is a small record:
 *
 *   repeats:
 *     every: week            day | week | month | year
 *     on: [tuesday]          weekdays · weekends · a list of days · {nth, day} · {date} · {date, month}
 *     at: '19:00'            wall clock, in its own zone
 *     zone: Europe/London
 *     lasts: 90m             a span: 45m · 2h · 1d
 *     until: '2027-01-01'    or count: 12; neither means it simply goes on
 *     except: ['2026-12-25'] days it does not happen, whatever the rule says
 *
 * WALL CLOCK WINS. "Every Tuesday at seven" means seven o'clock as the people in that zone read a
 * clock, on both sides of a daylight-saving change — so each occurrence is worked out in the zone
 * and turned into an instant, rather than an instant being advanced by seven days. The hour a
 * clock skips (the spring forward) has no seven-o'clock, and such an occurrence is left out rather
 * than quietly moved; the hour a clock repeats takes the first of the two.
 *
 * Pure: no imports, no environment, no clock of its own — every function takes the moment it
 * should reckon from. Pinned by build/recurrence.test.mjs.
 */

export const EVERY = ['day', 'week', 'month', 'year']
export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december']
/* the two words that stand for a set of days, because people say them */
export const DAY_SETS = { weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] }

/* ------------------------------------------------------------------ spans */

const SPAN = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|days|w|weeks)$/i
const SPAN_MS = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }
/* a span as milliseconds: `90m`, `2h`, `1d`. A number alone is minutes, which is what people mean. */
export function spanMs(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Math.round(v * 60000)
  const m = SPAN.exec(String(v).trim())
  if (!m) return null
  const unit = m[2][0].toLowerCase()
  return Math.round(Number(m[1]) * SPAN_MS[unit])
}

/* ------------------------------------------------------------------ the zone */

/* what a zone's clock read at an instant, as numbers. Intl is the only thing that knows the rules,
   and it is in every runtime this code meets. */
function partsIn(ms, zone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone || 'UTC', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = {}
  for (const { type, value } of f.formatToParts(ms)) p[type] = value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +(p.hour === '24' ? '00' : p.hour), mi: +p.minute, s: +p.second }
}

/* the instant at which a zone's clock reads this wall time, or null where the clock skips it.
   Found by guessing, reading the clock back and correcting — twice is enough for every real zone,
   and the third read is what catches an hour that does not exist. */
export function instantOf({ y, mo, d, h = 0, mi = 0 }, zone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let guess = wall
  for (let i = 0; i < 3; i++) {
    const p = partsIn(guess, zone)
    const got = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
    const off = wall - got
    if (off === 0) return guess
    guess += off
  }
  /* the clock never reads it — a spring-forward hour. Nothing happens at a time that did not exist. */
  const p = partsIn(guess, zone)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) === wall ? guess : null
}

/* which day of the week a date falls on, in its own zone */
const dowOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate()

/* ------------------------------------------------------------------ what a rule says */

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase()
const dayNumber = (v) => {
  const s = lower(v)
  const i = DAYS.indexOf(s)
  if (i >= 0) return i
  const short = DAYS.findIndex((d) => d.slice(0, 3) === s.slice(0, 3) && s.length >= 3)
  return short >= 0 ? short : null
}
const monthNumber = (v) => {
  if (typeof v === 'number') return v >= 1 && v <= 12 ? v : null
  const s = lower(v)
  const i = MONTHS.indexOf(s)
  if (i >= 0) return i + 1
  const short = MONTHS.findIndex((m) => m.slice(0, 3) === s.slice(0, 3) && s.length >= 3)
  return short >= 0 ? short + 1 : null
}

/* `on:` says which days a rule picks out, and takes every shape people write it in */
function readOn(on) {
  const out = { days: [], nth: [], dates: [] }
  if (on == null) return out
  for (const one of Array.isArray(on) ? on : [on]) {
    if (one == null) continue
    if (typeof one === 'object') {
      if (one.day != null && one.nth != null) {
        const d = dayNumber(one.day)
        const n = Number(one.nth)
        if (d != null && n !== 0 && n >= -5 && n <= 5) out.nth.push({ day: d, nth: n })
        continue
      }
      if (one.date != null) {
        const date = Number(one.date)
        const month = one.month != null ? monthNumber(one.month) : null
        if (date >= 1 && date <= 31) out.dates.push({ date, month })
      }
      continue
    }
    const s = lower(one)
    if (DAY_SETS[s]) { out.days.push(...DAY_SETS[s]); continue }
    if (s === 'last') { continue }
    const d = dayNumber(s)
    if (d != null) { out.days.push(d); continue }
    const n = Number(s)
    if (!Number.isNaN(n) && n >= 1 && n <= 31) out.dates.push({ date: n, month: null })
  }
  out.days = [...new Set(out.days)].sort()
  return out
}

/* a day written as a date, in the rule's own zone: '2026-12-25' */
const dayKey = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/* ------------------------------------------------------------------ is it well formed */

/* what is wrong with a repeat, as sentences a person could act on; [] when it is sound */
export function problems(repeats) {
  const r = repeats || {}
  const out = []
  if (!r.every) return ['A repeat says how often: every day, week, month or year.']
  if (!EVERY.includes(lower(r.every))) out.push(`"${r.every}" is not one of: ${EVERY.join(', ')}.`)
  if (r.at != null && !/^\d{1,2}:\d{2}$/.test(String(r.at).trim())) out.push(`"${r.at}" is not a time of day like 19:00.`)
  if (r.lasts != null && spanMs(r.lasts) == null) out.push(`"${r.lasts}" is not a length like 90m or 2h.`)
  if (r.count != null && !(Number(r.count) > 0)) out.push('A count is how many times it happens, so it is at least one.')
  if (r.until != null && Number.isNaN(Date.parse(String(r.until)))) out.push(`"${r.until}" is not a date.`)
  if (r.every && lower(r.every) === 'week' && readOn(r.on).days.length === 0 && r.on != null) {
    out.push('A weekly repeat is on days of the week — Tuesday, weekdays, or a list of them.')
  }
  const interval = r.interval == null ? 1 : Number(r.interval)
  if (!(interval >= 1)) out.push('An interval is how many of those go by between one and the next, so it is at least one.')
  for (const e of (r.except || [])) if (Number.isNaN(Date.parse(String(e)))) out.push(`"${e}" is not a date.`)
  return out
}

/* ------------------------------------------------------------------ when it happens */

/* every occurrence between two instants (inclusive of `from`, exclusive of `to`), as
   `{ start, end }` in milliseconds. `limit` caps the walk so a rule with no end is still finite. */
export function occurrences(repeats, { from, to, limit = 500 } = {}) {
  const r = repeats || {}
  if (problems(r).length) return []
  const zone = r.zone || 'UTC'
  const every = lower(r.every)
  const interval = Math.max(1, Number(r.interval || 1))
  const on = readOn(r.on)
  const [h, mi] = String(r.at || '00:00').split(':').map(Number)
  const lasts = spanMs(r.lasts) || 0
  const skip = new Set((r.except || []).map((e) => String(e).slice(0, 10)))
  const untilMs = r.until != null ? Date.parse(String(r.until).length <= 10 ? String(r.until) + 'T23:59:59Z' : String(r.until)) : null
  const count = r.count != null ? Number(r.count) : null

  /* the walk starts at the rule's own beginning where it has one, so that "every third week" counts
     from a day somebody chose rather than from whenever the page was opened */
  const startedAt = r.from != null ? Date.parse(String(r.from).length <= 10 ? String(r.from) + 'T00:00:00Z' : String(r.from)) : null
  const begin = startedAt != null ? Math.min(startedAt, from) : from

  const out = []
  let made = 0
  const p0 = partsIn(begin, zone)
  let y = p0.y, mo = p0.mo, d = p0.d

  /* which numbered weeks/months the interval lets through, reckoned from the rule's own start */
  const anchor = partsIn(startedAt != null ? startedAt : begin, zone)
  const weekIndex = (yy, mm, dd) => Math.floor((Date.UTC(yy, mm - 1, dd) - Date.UTC(anchor.y, anchor.mo - 1, anchor.d - dowOf(anchor.y, anchor.mo, anchor.d))) / 604800000)
  const monthIndex = (yy, mm) => (yy - anchor.y) * 12 + (mm - anchor.mo)

  const take = (yy, mm, dd) => {
    if (skip.has(dayKey(yy, mm, dd))) return true
    const start = instantOf({ y: yy, mo: mm, d: dd, h: h || 0, mi: mi || 0 }, zone)
    if (start == null) return true            /* an hour the clock skipped: it does not happen */
    if (untilMs != null && start > untilMs) return false
    if (start >= to) return false
    if (start >= from) { out.push({ start, end: start + lasts }); made++ }
    else if (start < from) { made++ }          /* counted against `count`, not returned */
    return !(count != null && made >= count)
  }

  for (let guard = 0; guard < 4000 && out.length < limit; guard++) {
    const days = daysInMonth(y, mo)
    let keep = true
    if (every === 'day') {
      if (Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(anchor.y, anchor.mo - 1, anchor.d)) / 86400000) % interval === 0) keep = take(y, mo, d)
    } else if (every === 'week') {
      const want = on.days.length ? on.days : [dowOf(anchor.y, anchor.mo, anchor.d)]
      if (want.includes(dowOf(y, mo, d)) && weekIndex(y, mo, d) % interval === 0) keep = take(y, mo, d)
    } else if (every === 'month') {
      if (monthIndex(y, mo) % interval === 0) {
        const dow = dowOf(y, mo, d)
        let hit = false
        for (const n of on.nth) {
          if (n.day !== dow) continue
          if (n.nth > 0 && Math.ceil(d / 7) === n.nth) hit = true
          if (n.nth < 0 && d > days + n.nth * 7) hit = true
        }
        for (const x of on.dates) if (x.month == null && (x.date === d || (x.date > days && d === days))) hit = true
        if (!on.nth.length && !on.dates.length && d === Math.min(anchor.d, days)) hit = true
        if (hit) keep = take(y, mo, d)
      }
    } else if (every === 'year') {
      const dated = on.dates.filter((x) => x.month != null)
      let hit = false
      for (const x of dated) if (x.month === mo && x.date === d) hit = true
      for (const n of on.nth) {
        const months = on.dates.filter((x) => x.month != null).map((x) => x.month)
        const inMonth = months.length ? months.includes(mo) : mo === anchor.mo
        if (inMonth && n.day === dowOf(y, mo, d) && n.nth > 0 && Math.ceil(d / 7) === n.nth) hit = true
      }
      if (!dated.length && !on.nth.length && mo === anchor.mo && d === anchor.d) hit = true
      if (hit && (y - anchor.y) % interval === 0) keep = take(y, mo, d)
    }
    if (!keep) break
    d++
    if (d > days) { d = 1; mo++; if (mo > 12) { mo = 1; y++ } }
    if (Date.UTC(y, mo - 1, d) > to + 86400000 * 400) break
  }
  return out
}

/* the next occurrence at or after an instant, or null where the rule is spent */
export function nextAfter(repeats, when, { zone } = {}) {
  const year = 86400000 * 400
  const found = occurrences(repeats, { from: when, to: when + year * 3, limit: 1 })
  return found.length ? found[0] : null
}

/* ------------------------------------------------------------------ saying it */

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth']
const clock = (at) => {
  if (!at) return ''
  const [h, m] = String(at).split(':').map(Number)
  const ampm = h < 12 ? 'am' : 'pm'
  const hh = h % 12 === 0 ? 12 : h % 12
  return m ? `${hh}:${String(m).padStart(2, '0')}${ampm}` : `${hh}${ampm}`
}
const listOf = (xs, and = 'and') => (xs.length <= 1 ? (xs[0] || '')
  : xs.slice(0, -1).join(', ') + ' ' + and + ' ' + xs[xs.length - 1])
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/* A REPEAT SAID IN PLAIN WORDS — what the editor shows beneath the fields, and what a page says of
   an event, so nobody reads a rule back off the controls that made it. */
export function describe(repeats, words = {}) {
  const r = repeats || {}
  if (problems(r).length) return ''
  const every = lower(r.every)
  const interval = Math.max(1, Number(r.interval || 1))
  const on = readOn(r.on)
  const w = { at: 'at', every: 'Every', other: 'Every other', nth: 'Every {n}', until: 'until', times: '{n} times', ...words }
  const howOften = interval === 1 ? w.every : interval === 2 ? w.other : w.nth.replace('{n}', ORDINALS[interval] || `${interval}th`)

  let what = ''
  if (every === 'day') what = interval === 1 ? 'day' : 'day'
  else if (every === 'week') {
    const five = DAY_SETS.weekdays.length === on.days.length && DAY_SETS.weekdays.every((d) => on.days.includes(d))
    what = on.days.length ? (five ? 'weekday' : listOf(on.days.map((d) => title(DAYS[d])))) : 'week'
  } else if (every === 'month') {
    if (on.nth.length) what = listOf(on.nth.map((n) => (n.nth < 0 ? 'last ' : (ORDINALS[n.nth] || n.nth + 'th') + ' ') + title(DAYS[n.day]))) + ' of the month'
    else if (on.dates.length) what = 'month on the ' + listOf(on.dates.map((x) => nth(x.date)))
    else what = 'month'
  } else if (every === 'year') {
    const dated = on.dates.filter((x) => x.month != null)
    what = dated.length ? listOf(dated.map((x) => title(MONTHS[x.month - 1]) + ' ' + nth(x.date))) : 'year'
  }

  let said = `${howOften} ${what}`.replace(/\s+/g, ' ').trim()
  if (r.at) said += ` ${w.at} ${clock(r.at)}`
  if (r.lasts) said += `, ${sayLength(spanMs(r.lasts))}`
  if (r.count) said += `, ${w.times.replace('{n}', r.count)}`
  else if (r.until) said += `, ${w.until} ${sayDate(r.until)}`
  return said
}

function nth(n) {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - n % 10 !== 10) * 1 && n % 10 < 4 ? n % 10 : 0]
  return n + (s || 'th')
}
function sayLength(ms) {
  if (!ms) return ''
  const mins = Math.round(ms / 60000)
  /* whole hours are said as hours; anything under two hours is said in the minutes people book it
     in (ninety minutes, not an hour and a half); longer and odd, the half reads better */
  if (mins % 60 === 0) { const h = mins / 60; return `${h} ${h === 1 ? 'hour' : 'hours'}` }
  if (mins < 120) return `${mins} minutes`
  const h = mins / 60
  return `${h.toFixed(1).replace(/\.0$/, '')} hours`
}
function sayDate(v) {
  const d = new Date(String(v).length <= 10 ? String(v) + 'T00:00:00Z' : String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return `${MONTHS[d.getUTCMonth()].slice(0, 1).toUpperCase() + MONTHS[d.getUTCMonth()].slice(1)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
