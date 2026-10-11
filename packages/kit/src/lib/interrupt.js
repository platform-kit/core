/*
 * What may interrupt a reader, and who has the corner.
 *
 * Two things in this kit put themselves over a page uninvited: an ad and the support chat. They
 * occupy the same corner, they arrive on the same timer, and until now each decided alone — so a
 * reader could get both at once, stacked, on a page where neither belonged. This module is the one
 * place that decides, and both of them ask it.
 *
 * **Two rules.**
 *
 * 1. Some pages are never interrupted. A place of work is not a place to be sold to: the admin, the
 *    reader's own app, a workspace, a form on its own page, the API reference, a book's own page,
 *    the preview and the share cards. On those, nothing appears — not a card, not a teaser, not a
 *    launcher.
 * 2. In one page view the corner belongs to whoever takes it first, and to nobody else. If an ad is
 *    going to show, the chat's pop-up is off for that page view, and the other way round. The
 *    claim is dropped when the reader goes somewhere else, because that is a new page view.
 *
 * Pure: no imports, no environment, pinned by build/interrupt.test.mjs.
 */

/* the prefixes nothing may appear over. `/app` is the reader's own instrument; `/spaces` a
   workspace; `/admin` the site's own machinery; `/embed/` is a frame inside SOMEBODY ELSE'S page,
   where the site turning up with a chat launcher would be the site turning up uninvited. */
export const QUIET = ['/admin', '/app', '/spaces', '/feed', '/p', '/__preview', '/__share', '/api', '/form/', '/to/', '/book/', '/cart/c/', '/support', '/embed/']

export function mayInterrupt(path, communityRoutes = []) {
  const p = String(path || '')
  if (!p.startsWith('/')) return false
  const prefixes = QUIET.concat(Array.isArray(communityRoutes) ? communityRoutes.filter((q) => typeof q === 'string' && q.startsWith('/')) : [])
  for (const q of prefixes) {
    if (q.endsWith('/')) { if (p.startsWith(q)) return false }
    else if (p === q || p.startsWith(q + '/')) return false
  }
  return true
}

/* ------------------------------------------------------------------ the corner */

let holder = null
let at = ''

/* a new page: the corner is free again */
export function newPageView(path) {
  if (String(path || '') === at) return
  at = String(path || '')
  holder = null
}

/* take the corner for this page view. The first to ask gets it; asking twice is fine. */
export function claimCorner(who) {
  if (holder && holder !== who) return false
  holder = who
  return true
}

export const cornerHolder = () => holder
export const cornerFree = () => holder === null

/* give it back — what a dismissed ad does, so the chat may still say something later on the page */
export function releaseCorner(who) { if (holder === who) holder = null }
