/*
 * A search as the reader builds it: some words, and narrowings they CHOOSE — a person, a channel, a
 * span of time. Pure, no imports, no environment, so the surface and build/spaces.test.mjs read the
 * same rules.
 *
 * There is no query syntax and there is never going to be one. A search box holds the words and
 * nothing else; who, where and when are controls beside it, and a chosen narrowing shows as a chip
 * that can be dropped. Nobody types `from:`, no placeholder teaches a grammar, and a search cannot
 * be got wrong by mistyping it. This module is the shape of what was chosen, and the arithmetic that
 * turns a chosen span into the two instants the database is asked for.
 */

/* the spans a reader picks from, in the order they are offered. `custom` is two dates from a picker. */
export const RANGES = ['any', 'today', 'yesterday', 'last-7-days', 'last-30-days', 'this-year', 'custom']

const startOfDay = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d }
const iso = (d) => d.toISOString()

/* a picked span → { after, before }, the instants the search is bounded by. `before` is exclusive. */
export function rangeDates(range, now = Date.now(), custom = {}) {
  const day = startOfDay(now)
  const back = (n) => { const d = startOfDay(now); d.setUTCDate(d.getUTCDate() - n); return d }
  switch (range) {
    case 'today': return { after: iso(day), before: null }
    case 'yesterday': return { after: iso(back(1)), before: iso(day) }
    case 'last-7-days': return { after: iso(back(7)), before: null }
    case 'last-30-days': return { after: iso(back(30)), before: null }
    case 'this-year': { const d = startOfDay(now); d.setUTCMonth(0, 1); return { after: iso(d), before: null } }
    case 'custom': return { after: dayStart(custom.after), before: dayEnd(custom.before) }
    default: return { after: null, before: null }
  }
}

/* a date as a picker gives it (YYYY-MM-DD) → the instant that day begins, or ends */
export function dayStart(v) {
  if (!v) return null
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00.000Z')
  return isNaN(d.getTime()) ? null : d.toISOString()
}
export function dayEnd(v) {
  const s = dayStart(v)
  if (!s) return null
  const d = new Date(s)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/* what the surface holds: the words, and the narrowings as they were chosen */
export const blankQuery = () => ({ text: '', from: null, in: null, range: 'any', after: null, before: null })

/* the query as the database is asked for it: the chosen span resolved to its two instants, and
   anything blank left out rather than sent as an empty string. */
export function queryArgs(q = {}, now = Date.now()) {
  const { after, before } = rangeDates(q.range || 'any', now, { after: q.after, before: q.before })
  return {
    q: String(q.text || '').trim(),
    from: q.from || null,
    in: q.in || null,
    after,
    before,
  }
}

/* is there anything to ask for at all */
export function emptyQuery(q = {}) {
  const a = queryArgs(q)
  return !a.q && !a.from && !a.in && !a.after && !a.before
}

/* how many narrowings are on, for the button that says so */
export function narrowingCount(q = {}) {
  const a = queryArgs(q)
  return (a.from ? 1 : 0) + (a.in ? 1 : 0) + ((a.after || a.before) ? 1 : 0)
}

/* the chips shown under the box: one per narrowing, each with what to drop when it is dismissed */
export function chipsOf(q = {}, words = {}, names = {}) {
  const out = []
  if (q.from) out.push({ key: 'from', label: (words.from || 'from {who}').replace('{who}', names[q.from] || q.from), clear: { from: null } })
  if (q.in) out.push({ key: 'in', label: (words.in || 'in {where}').replace('{where}', names[q.in] || q.in), clear: { in: null } })
  if (q.range && q.range !== 'any') {
    const label = q.range === 'custom'
      ? (words.between || 'between {a} and {b}').replace('{a}', String(q.after || '').slice(0, 10)).replace('{b}', String(q.before || '').slice(0, 10))
      : (words['range-' + q.range] || q.range)
    out.push({ key: 'range', label, clear: { range: 'any', after: null, before: null } })
  }
  return out
}

/* the whole search said plainly under the box, for a reader who wants to be sure what it will do */
export function describeQuery(q = {}, words = {}, names = {}) {
  const bits = []
  const text = String(q.text || '').trim()
  if (text) bits.push((words.words || 'words like “{q}”').replace('{q}', text))
  for (const c of chipsOf(q, words, names)) bits.push(c.label)
  return bits.join(words.join || ', ')
}
