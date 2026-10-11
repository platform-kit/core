/*
 * WHAT THE LAYOUT DRAWS THAT A PAGE MAY ALSO DRAW.
 *
 * The site's footer is chrome: the same on the store, an article, the reader and the landing, so
 * the layout draws it and no page has to remember to. But the page builder has a Footer section
 * too, because a landing page may want a different one, or one in a different place — and a page
 * that draws its own must not also get the layout's, or every such page ends in two footers.
 *
 * A page cannot tell its own layout anything (the layout is its parent, so there is nothing to
 * inject upward), and a prop would have to be threaded through every page there is. So it is a
 * ref: the page sets it while it is mounted and clears it on the way out, and the layout reads it.
 * One fact, one place, and a page that crashes mid-mount leaves the flag false rather than a
 * footer missing for ever.
 */
import { ref } from 'vue'

/* A PAGE THAT WANTS NO SITE FOOTER. Two reasons, one flag: its own sections name a Footer (so it
   would otherwise end in two), or its markdown says footer: false because the last thing on it IS
   the end — a landing whose close is the ground the whole page has been walking toward does not
   want a column of links under it. */
export const siteFooterOff = ref(false)
