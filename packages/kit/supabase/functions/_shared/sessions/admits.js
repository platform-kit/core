/*
 * WHO A BOOKING TYPE IS FOR — the one rule, shared by the app's picker (src/lib/booking.js) and by
 * the judge the functions ask before anything is booked (_shared/sessions.ts). Plain JavaScript,
 * no imports, no environment: the two sides of a gate that disagree are a gate.
 *
 * `requires` is one of:
 *
 *   anyone            everybody, signed in or not
 *   guest             somebody with no membership (signed in or not)
 *   authenticated     signed in, with no membership
 *   <a tier slug>     that tier AND EVERY HIGHER RANK — the shorthand, and the only place in this
 *                     rule where a rank is consulted at all
 *   [<slug>, …]       EXACTLY those tiers. Naming three tiers means those three and implies no
 *                     ladder, which is the only way to say it without the ranks deciding for you.
 *                     A space's `fill` has always read a list this way; this is the same grammar.
 *
 * `below` caps it: somebody at that tier or above is not offered the type, which is how a site
 * stops selling a one-off session to the people whose membership already includes it.
 */

/* what a tier ranks, from the memberships a site declares: { slug: rank } */
export const rankOf = (tiers, ranks) => Math.max(0, ...(tiers || []).map((t) => (ranks && ranks[t]) || 0))

export function admits(session, who) {
  const s = session || {}
  const tiers = (who && who.tiers) || []
  const ranks = (who && who.ranks) || {}
  const rank = who && who.rank != null ? who.rank : rankOf(tiers, ranks)
  const signed = !!(who && who.signed)
  /* a cap: somebody already at or above this tier is not offered it */
  if (s.below && rank >= ((ranks[s.below]) || 0)) return false
  if (s.requires === 'anyone') return true
  if (s.requires === 'guest') return rank === 0
  if (s.requires === 'authenticated') return signed && rank === 0
  if (Array.isArray(s.requires)) return s.requires.some((t) => tiers.includes(t))
  return rank > 0 && rank >= ((ranks[s.requires]) || 0)
}
