/*
 * WHAT A PAYMENT MEANS — the decisions, apart from the writing of them.
 *
 * `ledger.ts` is the most consequential file in the kit: a hundred and sixty-odd lines deciding
 * what somebody owns after they have paid. It had no test of its own, and the reason was structural
 * rather than neglectful — every decision in it sat between two database calls, so pinning one
 * meant standing up a stack, a Stripe mock and a served function. What is actually delicate is not
 * the writing; it is the deciding: who the buyer is, which offer a line is, and what that line
 * grants. Those are arithmetic over plain objects and belong where arithmetic can be read and
 * checked — the same move `admits.js`, `access.js` and `shipping.js` already make.
 *
 * Plain JavaScript, no imports, no environment: the functions run it and so does a test.
 */
import { checkVariant, readVariantKey } from './variants.js'

/*
 * WHO PAID. Three places say so and they are tried in order: what the checkout was told to carry,
 * Stripe's own reference, and last the customer the payment was made under. A guest has none of
 * them, and that is a real case rather than a failure — the purchase is written against the address
 * Stripe collected and claimed later when an account is made with it.
 */
export function buyerOf(session, byCustomer = null) {
  return (session && session.metadata && session.metadata.user_id) || (session && session.client_reference_id) || byCustomer || null
}

export function emailOf(session) {
  const email = String(session?.customer_details?.email || session?.customer_email || '').trim().toLowerCase()
  return email || null
}

/*
 * WHICH OFFER A LINE IS. The price's lookup key is the offer's KEY — its identity, which survives a
 * rename — and a price from before offers had keys carries the sku it was made under. Key first,
 * always: a sku may have been reused by another offer, a key never is.
 */
export function offerOfLine(line, byKey, bySku) {
  const price = (line && line.price) || {}
  /*
   * THE MARKS AN OFFER LEAVES ON A LINE, WHEREVER STRIPE PUT THEM.
   *
   * A line built from a catalog price carries the offer on the PRICE: its lookup key, and its
   * metadata. A line priced inline (`price_data`) has no price object of ours to carry anything
   * — the metadata goes on the PRODUCT, because that is where `product_data` puts it — and a
   * reader that only looked at the price found nothing at all.
   *
   * That is not hypothetical. Both paths that price inline are real: a paid offering, which has
   * no catalog entry to make a price from, and a line a price list re-priced. A line nobody can
   * attribute grants nothing: no unlock, no credit, no print order, and a purchase row with no
   * sku on it. Nothing throws; the buyer is simply charged and given nothing.
   *
   * So both places are read, price first. The expanded product is an object and the unexpanded
   * one is a string, so the object is used where there is one and ignored where there is not.
   */
  const onProduct = (price.product && typeof price.product === 'object' && price.product.metadata) || null
  const marks = { ...(onProduct || {}), ...(price.metadata || {}) }
  const key = price.lookup_key || marks.key || null
  const found = (key ? byKey(key) : null) || (marks.sku ? bySku(marks.sku) : null)
  return {
    offer: found || null,
    key,
    kind: (found && found.kind) || marks.kind || null,
    sku: (found && found.sku) || marks.sku || null,
    /* THE PRICE MAY NAME THE BOOK THE OFFER DOES NOT. A price written before the offer carried one,
       or by hand, says so in its own metadata; dropping that fallback would leave a reader who paid
       for an unlock without the book, and nothing would say why. */
    book: (found && found.book) || marks.book || null,
  }
}

/*
 * WHAT A LINE GRANTS, as a list of what to write. Every grant carries its own `source_id`, and that
 * is what makes a replay safe: the same payment writes the same rows.
 *
 * The rules, each of which somebody can lose money or access by:
 *
 *   anything paid for  the buyer is `paid`, whatever they bought.
 *   a book unlock      opens that book. A PRINTED copy or a FILE opens nothing online — they are
 *                      their own thing, and a reader who bought the paperback has not bought the
 *                      right to read it here.
 *   a session          one credit PER UNIT. Buying three is buying three, and each credit is its
 *                      own row (the source_id carries the index), or two of the three would
 *                      collide on the upsert and quietly become one.
 *   an offering        a provider's own session, which has no catalog entry at all — what was
 *                      bought is read off the line's own sku. Same credit, same shape.
 *   a form             one credit per unit, for the same reason: paying twice means answering
 *                      twice, and somebody buying a second reading has bought a second reading.
 *
 * A guest gets no grants — there is nobody to grant to — and the purchase still stands.
 */
export function grantsOf({ offer, sku, book, quantity = 1, sessionId, userId }) {
  if (!userId) return []
  const n = Math.max(1, Number(quantity) || 1)
  const out = [{ kind: 'class', key: 'paid', source_id: sessionId }]
  const kind = offer && offer.kind
  if (kind === 'book') {
    const opens = book || offer.book || null
    if (opens) out.push({ kind: 'product', key: opens, source_id: sessionId })
  }
  const credit = kind === 'session' ? 'session:' + offer.key
    : kind === 'form' ? 'form:' + offer.key
    : (!offer && sku && String(sku).startsWith('offering:')) ? 'session:' + sku
    : null
  if (credit) for (let i = 0; i < n; i++) out.push({ kind: 'product', key: credit, source_id: sessionId + ':' + i })
  return out
}

/* A PRINT LINE'S VARIANT — "contents.cloth.foil", as the cart carried it — checked against the
   offer's choices and filled in with its defaults; null for a variant the offer does not sell, which
   is how the checkout refuses a cloth the book's block never offered. Here rather than in offers.ts
   because it is a decision over plain data and nothing else: it can be read, and checked, on its own. */
/* THE SHAPES AN OFFER IS SOLD IN, whoever wrote them. An ordinary offer carries its options on
   its catalog record; a book in print carries contents, cloth and foil, which ARE its options in
   the order its key has always been written — derived from the block rather than named a second
   time, so a book that stops offering a cloth stops offering it here in the same breath. One
   function, because a caller that wants to read a variant back should not have to know which. */
export function offerOptions(o) {
  if (!o) return []
  if (o.options && o.options.length) return o.options
  if (!(o.kind === 'print' || o.kind === 'download') ) return []
  return [
    { name: 'Contents', values: (o.contents && o.contents.length ? o.contents : ['parts']) },
    ...(o.cloth && o.cloth.length ? [{ name: 'Cloth', values: o.cloth }] : []),
    ...(o.foil && o.foil.length ? [{ name: 'Foil', values: o.foil }] : []),
  ]
}

/*
 * WHAT A LINE SAYS IT WAS, a year from now.
 *
 * A sale has to read correctly long after the offer behind it has been renamed, re-priced, had
 * a value reworded or been unpublished altogether — and the catalog is the CURRENT truth, so
 * anything resolved by asking it later is the wrong answer. The row keeps its own copy: the
 * title as it read, the shape as a person says it ("Leather · Lined"), the option values with
 * their names, and the unit price actually charged.
 *
 * Three small decisions in here, each one a way of getting it wrong:
 *
 *   THE PRICE COMES FROM STRIPE, not from the offer. The offer may say $18 today; what the
 *   buyer paid is what the line was charged at, and those differ the moment a price changes.
 *
 *   THE LABEL IS FROZEN, not the key. "leather.lined" means nothing to a person and everything
 *   to the machine, so both are kept: `variant` stays the key, `variant_title` the words.
 *
 *   THE LINE'S TOTAL, NOT THE SESSION'S. A basket of two things is two rows, and a row that
 *   carried the whole basket's total made every sum of purchases wrong by the size of the order.
 */
export function lineSnapshot(bought, line, variant, session) {
  const qty = (line && line.quantity) || 1
  const price = (line && line.price) || {}
  const unit = price.unit_amount == null ? null : price.unit_amount
  const chosen = readVariantKey(variant || "", offerOptions(bought))
  return {
    title: (bought && bought.title) || (line && line.description) || null,
    variant_title: chosen.length ? chosen.map((c) => c.label || c.value).join(" · ") : null,
    options: chosen.length ? chosen : null,
    unit_price: unit,
    quantity: qty,
    /* Stripe gives the line its own total where it expanded one; otherwise unit × quantity, and
       only where there is neither does the session's own total stand in. */
    amount_total: (line && line.amount_total != null) ? line.amount_total
      : unit == null ? ((session && session.amount_total) ?? null) : unit * qty,
    currency: price.currency || (session && session.currency) || null,
  }
}

export function printVariant(o, variant) {
  if (!o) return null
  const opts = [
    { name: 'Contents', values: (o.contents && o.contents.length ? o.contents : ['parts']) },
    ...(o.cloth && o.cloth.length ? [{ name: 'Cloth', values: o.cloth }] : []),
    ...(o.foil && o.foil.length ? [{ name: 'Foil', values: o.foil }] : []),
  ]
  const chosen = checkVariant(opts, variant)
  if (!chosen) return null
  /* the shape print's callers read: three named fields, empty where the book offers no choice */
  return { contents: chosen.Contents || 'parts', cloth: chosen.Cloth || '', foil: chosen.Foil || '' }
}

/* what ships, what carries files, what opens online: the three questions a confirmation asks of a line */
export const ships = (offer) => !!offer && (offer.kind === 'print' || offer.kind === 'good')
export const carriesFiles = (offer) => !!offer && (offer.kind === 'download' || (offer.kind === 'print' && Array.isArray(offer.includes) && offer.includes.length > 0))
export const opensOnline = (offer) => !!offer && offer.kind === 'book'
