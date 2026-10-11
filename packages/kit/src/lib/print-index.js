/*
 * THE SET EDITIONS, FOR THE BROWSER — `content/store/print.json`, which says what each book's
 * editions are: their pages, their quotes, their cover art and the pictures of their pages. The
 * store draws a printed book from it (book-art.js) and prices one from it (storefront.js).
 *
 * IT IS DERIVED, so it is a file the build writes and never a collection — and that is exactly why
 * it needs this module. `#content`'s collections are refilled from public.content before the app is
 * evaluated (content-live.js), so in cloud mode a book published a moment ago is on the shelves. A
 * derived JSON has no collection and was therefore never refreshed: a book SET in a cloud-only admin
 * went into the row and the store went on showing whatever the last build knew, which in cloud mode
 * is forever. Its editions existed, were paid for, were orderable — and invisible.
 *
 * So the bundle's copy is the default and the live row replaces it. In git mode nothing calls the
 * setter and the glob stands, as it always did.
 */
import { here } from './bucket-host.js'

const BUILT = Object.values(import.meta.glob('#site/content/store/print.json', { eager: true, import: 'default' }))[0] || {}

let live = null

/* every book's editions by slug. Read it at CALL time, never bound at module scope: the live copy
   arrives after this module is evaluated and before the app is. */
export const editions = () => live || BUILT

/* one book's, or null */
export const editionsOf = (slug) => editions()[slug] || null

/* content-live.js, with the row's own text. Anything unparseable leaves the bundle's copy standing:
   a store that prices last week's editions is a great deal better than one that prices none. */
export function setEditions(text) {
  try {
    const j = typeof text === 'string' ? JSON.parse(text) : text
    if (j && typeof j === 'object' && !Array.isArray(j)) { live = hosted(j); return true }
  } catch { /* the bundle's copy stands */ }
  return false
}

/*
 * EVERY ADDRESS IN THE ROW, AT THE HOST THIS BROWSER KNOWS. The pictures were uploaded by an Edge
 * Function, which builds a public url from its own SUPABASE_URL — the project's address in
 * production, and the stack's inner `kong:8000` locally, which resolves inside Docker and nowhere
 * else. This is the ONE door the live index comes through, so it is the one place to do it.
 */
function hosted(j) {
  for (const book of Object.values(j)) {
    for (const e of Object.values((book && book.editions) || {})) {
      if (e.art) for (const k of Object.keys(e.art)) e.art[k] = here(e.art[k])
      if (e.shots) for (const k of ['edition', 'other', 'marks']) if (e.shots[k] && e.shots[k].art) e.shots[k].art = here(e.shots[k].art)
    }
  }
  return j
}
