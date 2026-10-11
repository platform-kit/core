/*
 * THE PALETTE'S INDEX, FETCHED RATHER THAN BUNDLED.
 *
 * `search.json` is the whole library's text over again — every article, page, book and product as
 * one searchable string. It was a static import of `content.js`, which is the library's read
 * surface and so in almost every page's import graph, and it therefore sat in the one shared chunk
 * every reader of every page downloaded: 1.5 MB of book text to look at a storefront.
 *
 * It is one dynamic import behind one accessor now. Three modules read it — the palette
 * (`content.js`), Find your book (`finding.js`) and the live preview (`content-live.js`) — and all
 * three go through here, which matters for more than tidiness: the preview REWRITES the array in
 * place so an edit shows in the palette, and that only works while all three hold the same array.
 * A module namespace is cached by the runtime, so they do.
 */
let rows = null
let pending = null

/* the rows, fetched once. Every caller was already async, so nothing above had to change shape. */
export async function corpus() {
  if (rows) return rows
  if (!pending) pending = import('#content/search.json').then((m) => (rows = m.default))
  return pending
}

/* what the preview has in hand, without fetching: null until somebody has asked for the index at
   all, in which case there is nothing of its to rewrite either. */
export const loadedCorpus = () => rows
