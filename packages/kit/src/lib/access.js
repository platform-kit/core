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
 * These rules decide what the reader is SHOWN. What they are SENT is _shared/gate.js:
 * the published bundle carries only what a guest may read, and a reader with more
 * access fetches the rest from the server (reader-content), which asks the same rules.
 */
import { CLASSES, allowedBy, requiredBy } from '../../supabase/functions/_shared/access.js'   /* the bar and the ladder, shared with the functions (the content API asks the same rule) */
export { allowedBy, requiredBy }

/* how many chapters a class may read (Infinity = all): the server's rule too, so the paywall drawn here
   matches what reader-content will send (_shared/gate.js) */
import { chapterAllowance } from '../../supabase/functions/_shared/gate.js'
export { chapterAllowance }

/* the lowest class whose allowance reaches chapter index i */
export function requiredForChapter(fm, i) {
  for (const c of CLASSES) if (chapterAllowance(fm, c) > i) return c
  return 'subscribed'
}
