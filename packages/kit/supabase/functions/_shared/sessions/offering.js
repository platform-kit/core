/*
 * A PROVIDER'S OFFERING, WEARING A BOOKING TYPE'S SHAPE — pure, no imports, shared by the browser
 * (src/lib/booking.js, for the list somebody chooses from) and the functions (_shared/sessions.ts,
 * for the judge, the scheduler and everything that follows a booking).
 *
 * It is here, in one file, because the two sides disagreeing about what an offering IS is the whole
 * class of fault this arrangement exists to avoid: a surface that offers a session the judge will
 * refuse, or a price the checkout does not know about.
 *
 * The site's own types are files and come from the catalog; an offering is a row, because a
 * declaration names classes of people and never a person. Once it is wearing this shape, nothing
 * downstream needs to know which of the two it is holding.
 */

/* an offering's event carries the ROW'S ID, so no name a person chooses can collide with a declared
   type's slug, and renaming one cannot orphan the bookings made against it */
export const OFFERING = 'offering:'
export const isOffering = (e) => String(e == null ? '' : e).startsWith(OFFERING)
export const offeringId = (e) => (isOffering(e) ? String(e).slice(OFFERING.length) : null)

/* the five words a booking type uses for where it happens — the same five, because an offering IS a
   booking type as far as everything downstream is concerned */
export const WHERES = ['none', 'video', 'link', 'place', 'phone']
export function whereOf(o) {
  const kind = WHERES.includes(String(o && o.where)) ? o.where : 'none'
  if (kind === 'link') return { kind, url: (o && o.place) || '' }
  if (kind === 'place') return { kind, address: (o && o.place) || '' }
  if (kind === 'phone') return { kind, number: (o && o.place) || '' }
  return { kind }
}

export function offeringType(o, { hostEmail = null } = {}) {
  const row = o || {}
  return {
    title: row.title, slug: row.slug, event: OFFERING + row.id, scheduler: 'native', username: null,
    /* WHOSE IT IS DECIDES THE TIMES, and nothing else about it is a rule: an offering is for whoever
       can reach the page it is on. A site that wants its community's sessions gated has booking types
       of its own for that, and an allowance is a thing a membership grants, not a thing a person sets
       about their own hours. */
    requires: 'anyone', below: null, weekly: 0, monthly: 0,
    /* A PRICED OFFERING IS A PAID SESSION, and its sku is its own address: there is no catalog entry
       to look a price up in, so the checkout reads the row and the credit is keyed on this. */
    sku: Number(row.price_cents) > 0 ? OFFERING + row.id : null,
    duration: Number(row.minutes) || 60,
    /* which of the host's sets of hours it is bookable in, by name; null is their default */
    schedule: row.schedule || null,
    hosts: hostEmail ? [hostEmail] : [],
    seats: 0, buffer: 0, notice: 0,
    where: whereOf(row), record: false,
  }
}
