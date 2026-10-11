/*
 * The access rules, in one place. They read two kinds of frontmatter:
 *
 *   canAccess: [guest, authenticated, paid, subscribed]
 *     a MINIMUM bar on the class ladder. Empty/absent = everyone. Listing
 *     [paid] admits paid and subscribed readers (the ladder is monotonic).
 *
 *   guestChapters / authenticatedChapters / paidChapters / subscribedChapters
 *     book freemium: how many chapters that class may read before the paywall.
 *     Unset = the whole book for that class. A higher class never gets fewer
 *     chapters than a lower one.
 *
 * This is the cosmetic (v1) gate: the text still ships in the bundle, these
 * rules only decide what the reader is shown. See the plan's "Deferred" note for
 * the server-enforced split.
 */
import { CLASSES, allowedBy, requiredBy } from '../../supabase/functions/_shared/access.js'   /* the bar and the ladder, shared with the functions (the content API asks the same rule) */
export { allowedBy, requiredBy }

const rank = (c) => Math.max(0, CLASSES.indexOf(c))

const KEYS = {
  guest: 'guestChapters',
  authenticated: 'authenticatedChapters',
  paid: 'paidChapters',
  subscribed: 'subscribedChapters',
}

/* how many chapters a class may read (Infinity = all) */
export function chapterAllowance(fm, cls) {
  let best = -1
  for (const c of CLASSES) {
    if (rank(c) > rank(cls)) break
    const v = fm && fm[KEYS[c]]
    best = Math.max(best, typeof v === 'number' ? v : Infinity)
  }
  return best < 0 ? Infinity : best
}

/* the lowest class whose allowance reaches chapter index i */
export function requiredForChapter(fm, i) {
  for (const c of CLASSES) if (chapterAllowance(fm, c) > i) return c
  return 'subscribed'
}
