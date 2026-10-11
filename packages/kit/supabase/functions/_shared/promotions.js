/*
 * A DISCOUNT, AND WHAT IT TAKES OFF — Medusa's promotion model, read off its source.
 *
 * A promotion is NOT a price. A price list says "for these people the price IS X"; a promotion
 * says "take Y off". They are separate modules in Medusa and they are separate here, because
 * each one is unable to say what the other says:
 *
 *   a price list cannot say "20% off", only "$14" — which is wrong the moment the product is
 *   re-priced, can silently become a price RISE, and cannot take 20% off a member's own rate;
 *
 *   a promotion cannot say "in Germany this costs €22", because that is not a discount.
 *
 * WHAT A PROMOTION CARRIES (core/utils/src/promotion/index.ts):
 *
 *   type         standard | buyget
 *   status       draft | active | inactive
 *   method       percentage | fixed, with a value
 *   target       items | order | shipping
 *   allocation   each | across | once
 *   max_quantity how many units of a line it reaches
 *   rules        who and what it is for; every one must hold
 *
 * ALLOCATION IS THE FIELD THIS PROJECT TRIED TO DO WITHOUT. "$5 off" means nothing until somebody
 * says whether that is $5 a unit, $5 spread over the line, or $5 once — and the arithmetic
 * genuinely differs (core/utils/src/totals/promotion/index.ts):
 *
 *   each     the value applies within each line, capped at what is left of that line
 *   across   the value is distributed PROPORTIONALLY by each line's share of the total, and
 *            re-distributed over what remains after promotions already applied
 *   once     the value comes off a single line (the dearest), once
 *
 * Every adjustment is floored at nothing and capped at the amount it is taken from, so no
 * combination of promotions can make a line negative or pay somebody to shop.
 */

export const PROMOTION_TYPES = ['standard', 'buyget']
export const PROMOTION_STATUS = ['draft', 'active', 'inactive']
export const METHODS = ['percentage', 'fixed']
export const TARGETS = ['items', 'order', 'shipping']
export const ALLOCATIONS = ['each', 'across', 'once']

/* what a promotion is worth against one amount. A percentage is of that amount; a fixed value is
   the value itself, and the caller has already decided what share of it this line gets. */
export const valueOf = (promo, amount) =>
  promo.method === 'percentage'
    ? Math.round((Number(promo.value) || 0) / 100 * amount)
    : Math.round(Number(promo.value) * 100)

/* how many units of a line a promotion reaches */
export const unitsOf = (line, promo) =>
  promo.max_quantity ? Math.min(Number(line.quantity) || 1, Number(promo.max_quantity)) : (Number(line.quantity) || 1)

/* is this line one the promotion is for? `applies` names skus (and optionally shapes); naming
   none means every line, which is the common case written short. */
export function touches(promo, line) {
  const on = promo && promo.applies
  if (!Array.isArray(on) || !on.length) return true
  return on.some((x) => x && x.sku === line.sku && (!x.variant || x.variant === (line.variant || '')))
}

/* a promotion is live when it is active, inside its window, and every rule holds for this cart */
export function live(promo, context, now = null) {
  if (!promo) return false
  if ((promo.status || 'active') !== 'active') return false
  const t = now ? new Date(now).getTime() : Date.now()
  if (promo.starts && new Date(promo.starts).getTime() > t) return false
  if (promo.ends && new Date(promo.ends).getTime() < t) return false
  return (promo.rules || []).every((r) => ruleHolds(r, context))
}

/* the same rule grammar the price lists use, with the operators Medusa's promotion rules have
   (which include `in` and `ne`, unlike its pricing rules) */
export function ruleHolds(rule, context) {
  if (!rule || !rule.attribute) return false
  const have = String(rule.attribute).split('.').reduce((v, k) => (v == null ? v : v[k]), context)
  const want = rule.value
  const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
  switch (rule.operator || 'eq') {
    case 'eq': return Array.isArray(have) ? have.map(String).includes(String(want)) : String(have) === String(want)
    case 'ne': return Array.isArray(have) ? !have.map(String).includes(String(want)) : String(have) !== String(want)
    case 'in': return (Array.isArray(want) ? want : [want]).map(String).some((w) => (Array.isArray(have) ? have.map(String).includes(w) : String(have) === w))
    case 'gt': return n(have) !== null && n(have) > n(want)
    case 'gte': return n(have) !== null && n(have) >= n(want)
    case 'lt': return n(have) !== null && n(have) < n(want)
    case 'lte': return n(have) !== null && n(have) <= n(want)
    default: return false
  }
}

/*
 * WHAT COMES OFF EACH LINE — the whole arithmetic, over plain objects.
 *
 * `lines` are `{ sku, variant, unit_price, quantity }` at their STANDING price, which is what the
 * price lists already decided. Promotions are applied in order, each one seeing what the ones
 * before it already took, so two 50% promotions take 50% then 25% rather than the whole thing.
 *
 * Returns the lines with `discount` on each, and the cart's totals.
 */
export function apply(lines, promos, { context = {}, now = null } = {}) {
  const out = (lines || []).map((l) => ({
    ...l,
    subtotal: (Number(l.unit_price) || 0) * (Number(l.quantity) || 1),
    discount: 0,
    by: [],
  }))
  const on = (promos || []).filter((p) => live(p, { ...context, item_total: total(out) }, now))

  for (const promo of on) {
    const mine = out.filter((l) => touches(promo, l) && remaining(l) > 0)
    if (!mine.length) continue
    const target = promo.target || 'items'
    if (target === 'shipping' || target === 'order') continue   /* handled by the caller: not a line */

    if (promo.allocation === 'across') {
      /* PROPORTIONALLY, by each line's share of what is left — re-measured each time, so a second
         promotion distributes over the reduced amounts rather than the original ones */
      const pot = mine.reduce((n, l) => n + remaining(l), 0)
      if (pot <= 0) continue
      const whole = promo.method === 'percentage' ? Math.round(Number(promo.value) / 100 * pot) : Math.round(Number(promo.value) * 100)
      let left = Math.min(whole, pot)
      mine.forEach((l, i) => {
        /* the last line takes the rounding, so the parts always sum to the whole */
        const share = i === mine.length - 1 ? left : Math.min(left, Math.round(whole * (remaining(l) / pot)))
        const took = Math.min(share, remaining(l))
        l.discount += took; l.by.push(promo.name); left -= took
      })
    } else if (promo.allocation === 'once') {
      /* once, off the dearest line it touches */
      const l = mine.reduce((x, y) => (remaining(y) > remaining(x) ? y : x))
      const took = Math.min(valueOf(promo, remaining(l)), remaining(l))
      l.discount += took; l.by.push(promo.name)
    } else {
      /* EACH: within every line it touches, capped at what is left of that line and at the units
         the promotion reaches */
      for (const l of mine) {
        const units = unitsOf(l, promo)
        const reach = Math.min(remaining(l), (Number(l.unit_price) || 0) * units - taken(l, units))
        const took = Math.min(valueOf(promo, reach), reach)
        if (took > 0) { l.discount += took; l.by.push(promo.name) }
      }
    }
  }
  const subtotal = out.reduce((n, l) => n + l.subtotal, 0)
  const discount = out.reduce((n, l) => n + l.discount, 0)
  return { lines: out, subtotal, discount, total: Math.max(0, subtotal - discount) }
}

const remaining = (l) => Math.max(0, l.subtotal - l.discount)
const total = (lines) => lines.reduce((n, l) => n + Math.max(0, l.subtotal - l.discount), 0)
/* how much of what is already discounted falls inside the units a capped promotion reaches */
const taken = (l, units) => Math.min(l.discount, (Number(l.unit_price) || 0) * units)

/*
 * AND WHAT COMES OFF THE ORDER OR THE SHIPPING. Kept apart from the lines because they are
 * different money: an order-level discount is "£10 off orders over £50", which is the commonest
 * promotion there is and which a model with only per-item discounts cannot say at all.
 */
export function applyToTotal(amount, promos, { target = 'order', context = {}, now = null } = {}) {
  let left = Math.max(0, Number(amount) || 0)
  const by = []
  for (const promo of (promos || []).filter((p) => (p.target || 'items') === target && live(p, context, now))) {
    const took = Math.min(valueOf(promo, left), left)
    if (took > 0) { left -= took; by.push({ name: promo.name, amount: took }) }
  }
  return { amount: left, off: by.reduce((n, x) => n + x.amount, 0), by }
}
