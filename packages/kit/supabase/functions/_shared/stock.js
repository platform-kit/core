/*
 * IS THERE ONE LEFT? — pure, no io, no environment, so the page, the checkout function and the
 * tests all answer it the same way.
 *
 * Two different questions wear the same words in a shop and must not be confused:
 *
 *   UNSOLD is the FILE's answer. "We do not make leather in plain." It is a declaration, it is the
 *   same for everybody, and it never changes without an edit.
 *
 *   SOLD OUT is the DATABASE's answer. "We made it and there are none today." It is state, it
 *   differs by the minute, and nobody edits it.
 *
 * A shape can be either, and the reader is told different things: a shape nobody makes is struck
 * through for ever, a shape that has run out says so and may come back. Folding them into one
 * boolean is how a shop ends up telling somebody a thing is discontinued when it is on a lorry.
 *
 * THE DEFAULT IS BUYABLE. An offer that is not tracked, a deployment with no database to ask, a
 * count that has not loaded yet — all of them mean "sell it". The alternative is a static site
 * showing every product sold out because there is nowhere to keep a count, which is the worst
 * possible failure: silent, total, and in the direction of no sales.
 */

/* what the shop has, from a row of public.inventory; nothing known is `null`, not zero */
export function availableOf(counts, sku, variant = '') {
  if (!counts) return null
  const row = counts[sku + '\u0000' + (variant || '')] ?? counts[sku + '\u0000']
  if (!row) return null
  const n = Number(row.stocked || 0) - Number(row.reserved || 0)
  return n > 0 ? n : 0
}

/*
 * MAY THIS BE PUT IN A BAG? The whole rule, in one place.
 *
 * `backorder` beats everything: a shop that sells past zero has said the count is not a limit, so
 * it is not consulted. Untracked beats everything else, for the same reason. Only a tracked offer
 * with a count that is known and is zero refuses.
 */
/*
 * MADE ON DEMAND MEANS THERE IS NOTHING TO COUNT.
 *
 * A printed book and a download are made when they are bought; there is no shelf, no last one,
 * and nothing that can run out. Counting them would be counting an empty box and refusing a sale
 * on the strength of it.
 *
 * This held already, by accident — a print offer simply never carried `tracked` — and an accident
 * is not a guarantee: one `tracked: true` saved on the wrong record would have stopped a shop
 * selling a book it can print a thousand of. It is said outright now.
 */
export const madeOnDemand = (offer) => !!offer && ['print', 'download'].includes(offer.kind)

export function buyable(offer, variant, counts) {
  if (!offer) return false
  if (madeOnDemand(offer)) return true
  if (offer.tracked !== true || offer.backorder === true) return true
  const left = availableOf(counts, offer.sku, variant)
  return left === null ? true : left > 0
}

/* WHY a shape cannot be had, which is not the same question as whether it can — the reader is told
   a different thing for each, and `null` is "it can". */
export function whyNot(offer, variant, counts, unsold) {
  if (!offer) return null
  if (Array.isArray(unsold) ? unsold.includes(variant) : (offer.unsold || []).includes(variant)) return 'unsold'
  return buyable(offer, variant, counts) ? null : 'out'
}

/* AND THE WHOLE OFFER: a product every one of whose shapes is gone is sold out as a product, which
   is what a card says. One shape left is not sold out, however many are gone. */
export function offerOut(offer, variants, counts) {
  if (!offer || madeOnDemand(offer) || offer.tracked !== true || offer.backorder === true) return false
  const shapes = (variants && variants.length ? variants : [{ variant: '', sold: true }]).filter((v) => v.sold !== false)
  if (!shapes.length) return false
  /* a count nobody knows is not a count of zero: if NOTHING is known, the product is buyable */
  if (shapes.every((v) => availableOf(counts, offer.sku, v.variant) === null)) return false
  return shapes.every((v) => (availableOf(counts, offer.sku, v.variant) ?? 0) <= 0)
}

/* the key a count is held under, so the reader and the writer agree without saying it twice */
export const stockKey = (sku, variant = '') => sku + '\u0000' + (variant || '')
