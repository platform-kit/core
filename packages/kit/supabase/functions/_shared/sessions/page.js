/*
 * THE BOOKING PAGE'S OWN SWITCHES — pure, no imports, shared by the browser (the booker's look and
 * the row's buttons) and the functions (what they refuse). Two answers to "may they cancel this?"
 * that differ is a button that refuses when pressed, which is worse than no button.
 *
 * EVERY SWITCH DEFAULTS TO YES, so a type that says nothing behaves exactly as every type did
 * before there was a block at all. `cancel` and `reschedule` take a third answer, 'notice': they
 * may, until the type's own minimum notice, which is what most of them want.
 */
export const pageOf = (type) => (type && type.page) || {}

/* is a part of the page shown? notes · organiser · details · zone */
export const shows = (type, part) => pageOf(type)[part] !== false

/* WHETHER A READER MAY CANCEL OR MOVE THIS BOOKING NOW, and why not where they may not:
 *   { ok: true } | { ok: false, why: 'never' | 'too-soon' | 'past', hours }
 * A HOST IS NOT ASKED. These switches are about the reader's page; a host cancels a session they
 * are giving whenever they need to, which is what "the host's own" has always meant here.
 */
export function mayReader(type, what, startsAt, now = Date.now(), status = 'accepted') {
  const rule = pageOf(type)[what]
  if (rule === false) return { ok: false, why: 'never' }
  const start = typeof startsAt === 'number' ? startsAt : Date.parse(startsAt || '')
  const gone = Number.isFinite(start) && start < now
  /* a past or cancelled booking is closed unless the type says it may still be moved — and only
     moving: there is nothing to cancel about a session that has happened */
  if ((gone || status === 'cancelled') && !(what === 'reschedule' && pageOf(type).past === true)) return { ok: false, why: 'past' }
  const hours = Math.max(0, Number((type || {}).notice) || 0)
  /* 'notice' and true differ only in whether the notice is enforced: a type saying nothing has
     always enforced it, so true is the one that lets somebody move an hour before */
  if (rule !== true && hours > 0 && Number.isFinite(start) && start - now < hours * 36e5) return { ok: false, why: 'too-soon', hours }
  return { ok: true }
}

/*
 * DOES THIS BOOKING WAIT FOR THE HOST'S WORD? Pure, and shared, because the booker says "held" or
 * "booked" from the same answer the scheduler writes `pending` or `accepted` from — and a page that
 * says one while the row says the other is a page nobody can trust.
 *
 *   false      booking it is enough
 *   'notice'   only inside the type's own minimum notice: three weeks out is fine, tomorrow needs a
 *              look. This is the one most hosts want, and the one nobody would think to build.
 *   true       always
 */
export function waitsForYes(type, startsAt, now = Date.now()) {
  const rule = (type || {}).confirm
  if (rule === true) return true
  if (rule !== 'notice') return false
  const hours = Math.max(0, Number((type || {}).notice) || 0)
  const start = typeof startsAt === 'number' ? startsAt : Date.parse(startsAt || '')
  if (!Number.isFinite(start)) return true   /* no time to judge by: ask, rather than assume */
  return !hours || start - now < hours * 36e5
}

/*
 * THE LENGTHS A TYPE OFFERS, as rows with the default first — pure, so the booker draws exactly what
 * the booking will be checked against. A type that names none offers its own length and nothing to
 * choose from, which is what most of them are.
 */
export function lengthsOf(type) {
  const rows = Array.isArray((type || {}).lengths) ? (type || {}).lengths : []
  if (!rows.length) return []
  /* a length may be written as a bare number of minutes or as a row with a price of its own, and
     the collection keeps whichever was written — so both are read here rather than in two places */
  return rows.map((x) => (typeof x === "number" ? { minutes: x } : x || {})).map((r) => ({ minutes: Math.max(5, Number(r.minutes) || 0), price: r.price || (type || {}).price || '', sku: r.sku || (type || {}).sku || null })).filter((r) => r.minutes)
}
/* the one a booking is being made at: the length asked for if the type offers it, else its default */
export function lengthChosen(type, minutes) {
  const rows = lengthsOf(type)
  if (!rows.length) return { minutes: Math.max(5, Number((type || {}).duration) || 60), price: (type || {}).price || '', sku: (type || {}).sku || null }
  return rows.find((r) => r.minutes === Number(minutes)) || rows[0]
}

/*
 * WHAT A BOOKING IS CALLED. A type's title is what somebody picks from a list; it is not always what
 * belongs in a calendar beside four other things — "One on one" tells nobody which one. Four
 * variables, all of them facts the booking already has, and a type that says nothing keeps its
 * title, which is what every type did before there was a name at all.
 */
export function nameOf(type, { reader = '', host = '', length = 0 } = {}) {
  const pattern = (type || {}).name
  const title = (type || {}).title || ''
  if (!pattern) return title
  return String(pattern).replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'reader') return reader || ''
    if (k === 'host') return host || ''
    if (k === 'type') return title
    if (k === 'length') return String(length || (type || {}).duration || '')
    return ''
  }).replace(/\s{2,}/g, ' ').trim() || title
}
