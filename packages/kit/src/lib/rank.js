/*
 * HOW A ROW IS SCORED FOR A READER — the arithmetic of Recommended For You, pure.
 *
 * It is here rather than inside content.js because content.js reaches the compiled collections and
 * the router and so cannot be loaded under node at all, and the one thing about a ranking worth
 * pinning is the arithmetic: that history reorders a ranking without overturning what a site put in
 * front of somebody deliberately, and that a reader with no site registration gets a ranking rather
 * than none. `forYou` in content.js is this, over the corpus.
 *
 * Four claims, in order of how loudly they speak:
 *   PRESCRIBED   a site putting this item in front of THIS reader. The strongest thing there is.
 *   THEME TAG    the site saying this tag matters to this reader.
 *   WEIGHT       the reader's own history saying so (my_interests): what they read, what they bought.
 *   SIMILARITY   the fuzzy long tail, and on a site with no registration the whole of it.
 * A theme tag and a weight are different claims — one is the site's, one is the reader's own — so a
 * row that earns both gets both, and no amount of history can outrank a prescription.
 */
export const THEME_LIFT = 0.15
export const RX_LIFT = 0.5
export const WEIGHT_LIFT = 0.04

/* a row's weight is its heaviest tag, not the sum: a piece tagged with five things the reader
   likes a little is not more relevant than the one piece about the thing they like most. */
export function weightOf(tags, weights) {
  return (tags || []).reduce((m, t) => Math.max(m, Number((weights || {})[String(t).toLowerCase()]) || 0), 0)
}

export function scoreRow({ sem = 0, tags = [], href = '' }, { themeTags = [], prescribed = null, weights = null } = {}) {
  const themes = themeTags.map((t) => String(t).toLowerCase())
  const matchTag = (tags || []).some((t) => themes.includes(String(t).toLowerCase()))
  const isRx = prescribed ? prescribed.has(href) : false
  const w = weightOf(tags, weights)
  return { sem, weight: w, score: sem + (matchTag ? THEME_LIFT : 0) + (isRx ? RX_LIFT : 0) + w * WEIGHT_LIFT }
}

/* the tags in the order the reader's own history puts them */
export function tagsOf(weights, limit = 8) {
  return Object.entries(weights || {}).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([s]) => s)
}

/*
 * THE SENTENCE THE RANKING IS A QUERY FOR, written by the kit out of the reader's own tags.
 *
 * This is the piece that was missing. forYou ranks by similarity to a vector embedded from a
 * sentence about the reader, and only a site could write one — so a site with no registration had
 * no sentence, no vector and an empty lane, not for want of anything to go on but for want of
 * anybody having said what to do with it. The words are the tags themselves, because those are
 * the same words the content is tagged with and so the ones an embedding can match. Nobody is ever
 * shown this; it is the query. Where a site offers words of its own the two are JOINED — a site
 * knowing something extra is not a reason to throw away what the reader did.
 */
export function profileText(weights, siteText = '', limit = 8) {
  const list = tagsOf(weights, limit)
  const ours = list.length ? 'Interested in ' + list.join(', ') + '.' : ''
  return [String(siteText || '').trim(), ours].filter(Boolean).join(' ')
}
