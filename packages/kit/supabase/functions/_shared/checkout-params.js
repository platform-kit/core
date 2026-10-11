/*
 * WHAT STRIPE ALREADY DOES, RESOLVED FROM A CART — pure, no imports, no environment, so the
 * function (Deno) and the kit's test (node) read the same arithmetic. Four things Stripe has always
 * offered and this store never passed: a trial, tax, the payment methods accepted, and a quantity
 * the buyer may change.
 *
 * The only real decisions here are how a cart of SEVERAL offers resolves a parameter that belongs
 * to the session rather than to a line, and each is a judgement somebody should be able to find:
 *
 *   trial     a subscription session is one offer by construction, so the trial is that offer's.
 *             A trial asked for on a one-off was refused by the catalogue at build.
 *   tax       ANY offer asking for it turns it on. The alternative — every offer must agree —
 *             silently does not charge tax on a mixed cart, and under-collecting tax is the
 *             mistake that costs money much later.
 *   payments  the INTERSECTION, so a cart never offers a method one of its offers does not accept.
 *             Empty means Stripe's own default, which is exactly what was sent before any of this.
 *   adjustable  belongs to its own line, so it is per line and not here.
 */

/* the session-wide three. `offers` is the catalogue records of what is in the cart, in any order. */
export function sessionParams(offers = [], mode = 'payment') {
  const list = (offers || []).filter(Boolean)
  const trial = mode === 'subscription' ? Number(list.find((o) => o && o.trial)?.trial || 0) : 0
  const automaticTax = list.some((o) => o && o.tax && o.tax.automatic === true)
  const taxId = list.some((o) => o && o.tax && o.tax.registration === true)

  /* every offer that named methods; one that named none accepts whatever the shop does */
  const declared = list.map((o) => (o && Array.isArray(o.payments) ? o.payments : null)).filter((m) => m && m.length)
  const methods = declared.length ? declared.reduce((a, b) => a.filter((m) => b.includes(m))) : []

  return { trial, automaticTax, taxId, methods }
}

/* a line's own adjustable quantity, or null where the offer did not ask for one. The offer's field
   is `adjustable`, not `quantity`: a content file may never carry a count of anything, and
   declarations.test.mjs refuses a field that reads like one — correctly, since stock is a row. */
export function lineQuantity(offer) {
  if (!offer || !offer.adjustable) return null
  const min = Number(offer.adjustable.min ?? 1)
  const max = Number(offer.adjustable.max ?? 99)
  if (!(min >= 1) || !(max >= min)) return null
  return { enabled: true, minimum: min, maximum: max }
}

/*
 * ONE TRIAL PER PERSON PER TIER. Without this, cancel and rejoin is a free membership forever.
 *
 * Per TIER rather than per offer, because a weekly and a monthly offer of one tier must not grant
 * two trials — they are the same membership bought at two cadences.
 *
 * `taken` is the keys of this person's subscriptions that ever had a trial (subscriptions.trialed,
 * which is sticky, so a cancelled row still says it happened). `tierOf` maps an offer key to its
 * tier through the catalogue, so a tier renamed in a file does not strand the fact and nothing is
 * stored twice. An offer with no tier — a non-membership subscription — is per offer key instead,
 * since there is no tier to share.
 */
export function trialDaysFor(offer, taken = [], tierOf = () => null) {
  const days = Number(offer && offer.trial) || 0
  if (!days) return 0
  const mine = tierOf(offer.key)
  const had = (taken || []).some((k) => (mine ? tierOf(k) === mine : k === offer.key))
  return had ? 0 : days
}
