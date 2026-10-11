/*
 * The access rule, once, for the app and the functions alike (plain JavaScript: no environment, no imports):
 * the class ladder — guest < authenticated < paid < subscribed — a record's `canAccess` as the lowest rung that
 * clears it, and the rung an account stands on from its entitlements. lib/auth.js and lib/access.js read the
 * ladder from here; the content API asks `mayReadEntry` before it serves a gated entry's body.
 */
export const CLASSES = ['guest', 'authenticated', 'paid', 'subscribed']
const rank = (c) => Math.max(0, CLASSES.indexOf(c))

/* monotonic: a subscriber also clears every lower bar */
export const hasClass = (current, required) => CLASSES.indexOf(current) >= CLASSES.indexOf(required)

/* canAccess is a MINIMUM bar on the ladder: empty or absent admits everyone; [paid] admits paid and subscribed */
export function allowedBy(canAccess, cls) {
  if (!Array.isArray(canAccess) || !canAccess.length) return true
  return rank(cls) >= Math.min(...canAccess.map(rank))
}

/* the lowest class that clears a canAccess bar */
export function requiredBy(canAccess) {
  if (!Array.isArray(canAccess) || !canAccess.length) return 'guest'
  return CLASSES[Math.min(...canAccess.map(rank))]
}

/* the rung an account stands on: what get_my_entitlements says its class is, else authenticated; no account, guest */
export function classOf(entitlements, signedIn) {
  if (!signedIn) return 'guest'
  const c = entitlements && entitlements.class
  return c === 'paid' || c === 'subscribed' ? c : 'authenticated'
}

export const mayRead = (canAccess, entitlements, signedIn) => allowedBy(canAccess, classOf(entitlements, signedIn))

/* a book bought outright lifts its buyer to paid for that book, as the reader does (BookReader.vue's effClass) */
export function mayReadEntry(entry, entitlements, signedIn) {
  let cls = classOf(entitlements, signedIn)
  const owned = entry && entry.kind === 'books' && entitlements && Array.isArray(entitlements.products) && entitlements.products.includes(entry.slug)
  if (owned && rank(cls) < rank('paid')) cls = 'paid'
  return allowedBy(entry && entry.canAccess, cls)
}
