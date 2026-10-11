/*
 * A MANAGED TYPE, DERIVED ONTO EACH MEMBER — pure, no imports, shared by the browser (the list on
 * somebody's own page) and the functions (the judge, the scheduler, the booking).
 *
 * A managed booking type is ONE file and N members: the business writes it once — the length, the
 * price, where it happens, who may book — and every member of its team gets it as their own, at
 * their own address, on their own hours, editable by nobody. Nothing writes a row per member: the
 * copies are COMPUTED where they are read, exactly as a projection is, which is the whole reason a
 * team can be a file. With a record per copy there would be a second thing to keep in step, and the
 * day it drifted nobody could say which was right.
 *
 * A member joining gains theirs the moment the row exists. A member leaving stops theirs being
 * bookable — and the bookings already made against it STAND, because those are rows, and rows do
 * not vanish when a rule changes.
 */

/* a copy's event carries the member's username after the type's slug, so it is an address somebody
   can be given ("book me at /p/ada") and can never collide with a declared type's slug */
export const MANAGED = '@'
export const managedEvent = (slug, username) => `${slug}${MANAGED}${String(username || '').toLowerCase()}`
export const isManaged = (e) => String(e == null ? '' : e).includes(MANAGED)
/* → { slug, username } for a managed event, else null */
export function parseManaged(e) {
  const s = String(e == null ? '' : e)
  const i = s.indexOf(MANAGED)
  if (i <= 0 || i === s.length - 1) return null
  return { slug: s.slice(0, i), username: s.slice(i + 1).toLowerCase() }
}

/*
 * The copy itself: the type as written, given one host and one address. Everything the business
 * decided stays the type's (a member cannot change the length, the price or the gate — that is what
 * *managed* means); everything about WHEN becomes the member's, because their hours are theirs.
 *
 *   type    the declared type, from the catalog
 *   person  { email, username, name }
 */
export function managedCopy(type, person) {
  if (!type || !person || !person.username) return null
  return {
    ...type,
    event: managedEvent(type.slug, person.username),
    hosts: [String(person.email || '').toLowerCase()],
    rota: [],
    team: null,
    /* one host, so there is nobody to share with and nothing to intersect */
    assign: 'one',
    managed: { of: type.slug, username: String(person.username).toLowerCase(), name: person.name || '' },
  }
}

/* every managed type a person holds a copy of: the published managed types whose team they are in.
   `memberOf` is the set of team slugs that person belongs to — rows, asked for by the caller. */
export function managedFor(sessions, person, memberOf) {
  const teams = memberOf instanceof Set ? memberOf : new Set(memberOf || [])
  return (sessions || [])
    .filter((s) => s && s.assign === 'managed' && s.team && teams.has(s.team) && s.published !== false)
    .map((s) => managedCopy(s, person))
    .filter(Boolean)
}
