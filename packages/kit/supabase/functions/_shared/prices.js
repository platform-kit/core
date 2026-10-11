/*
 * WHAT THIS COSTS, FOR THIS PERSON, TODAY — pure, no io, no environment, so the page and the
 * checkout function answer with the same code. A price shown that is not the price charged is the
 * worst bug this module can have, and the cheapest guard against it is that there is only one
 * thing to get right.
 *
 * ONE MECHANISM. There is no "the price on the variant" and then "price lists" beside it: the
 * build compiles an offer's own prices into a list like any other — the BASE list, no audience, no
 * window, the shop's own currency — and this walks lists and nothing else. A shop with one
 * currency and no sales writes a number beside a variant and never learns the word "list"; a shop
 * with four currencies and a members' rate adds files and changes nothing about how the first
 * shop works. Two paths answering one question is how a bug gets a home.
 *
 * MOST SPECIFIC WINS, NOT CHEAPEST. This was got wrong first time and is worth stating plainly,
 * because cheapest-wins is the instinct. Medusa's documented algorithm has no such rule: no
 * matching rules → the base price; an exact match → that price; otherwise the price matching the
 * MOST rules. A member's price that happens to be higher than a clearance price is still the
 * member's price — the shop decides what specificity means, rather than arithmetic deciding it.
 *
 * SALE OR OVERRIDE decides what the reader is shown, not what they pay. A `sale` list's price is
 * never the original, so the base price is struck through beside it; an `override` list's price IS
 * the original, so nothing is struck through. That is the whole difference and it is why the kind
 * is a field rather than decoration.
 */

export const OPERATORS = ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']
export const LIST_KINDS = ['sale', 'override']

/* a rule holds or it does not; an operator nobody knows never holds, rather than quietly passing */
export function ruleHolds(rule, context) {
  if (!rule || !rule.attribute) return false
  const have = valueAt(context, rule.attribute)
  const want = rule.value
  switch (rule.operator || 'eq') {
    case 'eq': return Array.isArray(have) ? have.map(String).includes(String(want)) : String(have) === String(want)
    case 'ne': return Array.isArray(have) ? !have.map(String).includes(String(want)) : String(have) !== String(want)
    case 'in': return (Array.isArray(want) ? want : [want]).map(String).some((w) => (Array.isArray(have) ? have.map(String).includes(w) : String(have) === w))
    case 'gt': return num(have) !== null && num(have) > num(want)
    case 'gte': return num(have) !== null && num(have) >= num(want)
    case 'lt': return num(have) !== null && num(have) < num(want)
    case 'lte': return num(have) !== null && num(have) <= num(want)
    default: return false
  }
}
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
/* `customer.tiers` reads through a dotted path, as the documented attributes do */
const valueAt = (o, path) => String(path).split('.').reduce((v, k) => (v == null ? v : v[k]), o)

/* a window: a list may start, end, or do neither. An undated list is always open. */
export function openAt(list, now) {
  const t = now ? new Date(now).getTime() : Date.now()
  if (list.starts && new Date(list.starts).getTime() > t) return false
  if (list.ends && new Date(list.ends).getTime() < t) return false
  return true
}

/* a price entry may be for a quantity band; one with neither bound is for any quantity */
const quantityFits = (p, qty) => {
  const q = Number(qty) || 1
  if (p.min_quantity != null && q < Number(p.min_quantity)) return false
  if (p.max_quantity != null && q > Number(p.max_quantity)) return false
  return true
}

/*
 * THE ALGORITHM, in the order Medusa documents it.
 *
 *   1. every entry for this variant, in a list that is open and in the right currency, whose
 *      quantity band fits;
 *   2. of those, the ones whose EVERY rule holds for this context (a rule that does not hold
 *      disqualifies the entry — a members' price is not for a guest at a lower specificity, it is
 *      simply not for them);
 *   3. the one matching the most rules wins; a tie is broken by the list's `priority`, then by
 *      the entry being more specific about quantity, and only then — deterministically rather
 *      than meaningfully — by the list's name.
 *
 * The BASE list has no rules, so it always matches with a score of zero and is the floor. There is
 * therefore always an answer where the variant has any price at all.
 */
/*
 * WHICH PRICE, FOR THIS PERSON, TODAY — Medusa’s model, read off its source rather than recalled.
 *
 * A price list is a CONTEXTUAL ABSOLUTE PRICE: "for these people, in this market, it costs X."
 * A market priced tax-inclusive, a wholesale rate, a members’ rate. It is NOT a discount; a
 * percentage or a flat amount off is a promotion, which is its own thing and applies on top of
 * whatever this answers (see promotions.js). Conflating the two was this module’s first design
 * and it could not express either properly.
 *
 * THE ORDERING is three keys, not one (medusa pricing/src/repositories/pricing.ts:310-312):
 *
 *   a list price beats a plain one      price_list_id IS NOT NULL DESC
 *   then the most rules matched         price.rules_count + pl.rules_count DESC
 *   then the cheapest                   price.amount ASC
 *
 * The cheapest tiebreak is real and was denied twice in this project’s own design notes. It only
 * ever decides between prices of EQUAL specificity, which is why it is not "cheapest wins".
 *
 * AND THE RESOLUTION, in Medusa’s own words (pricing-module.ts:429-432):
 *
 *   "If the price list is of type OVERRIDE, we always use the price list price. If there are
 *    multiple OVERRIDE prices, we use the one with the lowest amount. If the price list is of
 *    type SALE, we use the lowest price between the price list price and the default price."
 *
 * The struck-through reference is "the matching OVERRIDE price list price if one applies,
 * otherwise the default price" — taken over the non-sale subset, so a sale stacked on top of a
 * member’s rate shows the saving against THEIR rate rather than against the shop’s.
 */

export function priceOf(lists, { sku = '', variant = '', currency = 'usd', quantity = 1, context = {}, now = null } = {}) {
  const cur = String(currency || 'usd').toLowerCase()
  const all = []
  for (const list of lists || []) {
    if (!openAt(list, now)) continue
    if (list.status && list.status !== 'active' && list.kind !== 'base') continue
    const rules = list.rules || []
    /* a price matches only where it has no rules, or EVERY one of them holds */
    if (!rules.every((r) => ruleHolds(r, context))) continue
    for (const price of list.prices || []) {
      /* a price belongs to its product and its shape, and a caller naming neither gets nothing */
      if (String(price.sku || '') !== String(sku || '')) continue
      if ((price.variant || '') !== (variant || '')) continue
      if (String(price.currency || cur).toLowerCase() !== cur) continue
      if (!quantityFits(price, quantity)) continue
      all.push({ list, price, rules: rules.length + bands(price) })
    }
  }
  if (!all.length) return null

  /* Medusa's three keys, in order */
  all.sort((x, y) =>
    isBase(x) - isBase(y)
    || y.rules - x.rules
    || x.price.amount - y.price.amount)

  const fromList = all.find((c) => c.list.kind !== 'base') || null
  const plain = all.find((c) => c.list.kind === 'base') || null

  /* the reference price: the matching OVERRIDE if there is one, else the shop’s own — taken over
     the non-sale subset so a sale does not anchor it back to the base */
  const override = all.find((c) => c.list.kind === 'override') || null
  const reference = override || plain || fromList

  let chosen = plain || fromList
  if (fromList) {
    if (fromList.list.kind === 'override') chosen = override || fromList
    else chosen = plain && plain.price.amount < fromList.price.amount ? plain : fromList
  }

  const amount = chosen.price.amount
  const was = reference ? reference.price.amount : amount
  return {
    amount,
    currency: cur,
    /* struck through only where the chosen price is a SALE under what they would otherwise pay */
    original: chosen.list.kind === 'sale' && was > amount ? was : null,
    list: chosen.list.name || 'base',
    kind: chosen.list.kind || 'base',
    /* what this person pays before any promotion — what a discount comes off */
    standing: amount,
    shop: plain ? plain.price.amount : amount,
  }
}
const isBase = (c) => (c.list.kind === 'base' ? 1 : 0)
const bands = (p) => (p.min_quantity != null ? 1 : 0) + (p.max_quantity != null ? 1 : 0)

/* every currency a variant has a price in, which is what a Stripe price's `currency_options` is
   built from — one price per variant carrying them all, never a second price per currency */
export function currenciesOf(lists, variant = '') {
  const out = new Set()
  for (const list of lists || []) for (const p of list.prices || []) {
    if ((p.variant || '') === (variant || '') && p.amount != null) out.add(String(p.currency || 'usd').toLowerCase())
  }
  return [...out]
}
