/*
 * KINDS OF THING A SHOP SELLS, and the seam they reach the store through.
 *
 * Three kinds are in scope and their needs barely overlap: a book in print has editions, a trim,
 * a spine, foil and a typeset interior; a garment made on demand has a blueprint, a placement and
 * artwork; an ordinary product has none of that and may have stock, which neither of the others
 * ever does. Putting all of it in one table gives every query a column it must ignore; building
 * three systems is what print already did once and this change exists to stop.
 *
 * So A KIND IS A REGISTRATION — as a model is, as a landing section is, as a supplier is, as an
 * image source is. It owns everything true only of it, including its own storage and its own
 * build step, and it reaches the store through EXACTLY TWO SLOTS:
 *
 *   options(offer)      the options and their values this kind supplies for that offer, from
 *                       wherever it gets them: derived from a print block, fetched from a
 *                       supplier's catalogue, or typed by the shop (which is no kind at all).
 *
 *   artefacts(variant)  an OPAQUE record of whatever a build made for one variant — a book's
 *                       { interior, cover, pages, edition }, a garment's { printFile, placement }.
 *
 * THE STORE NEVER OPENS THE PARCEL. It stores the record, hands it to a supplier, and may ask
 * only one question about it: `ready` — because a thing that cannot be made yet cannot be sold
 * yet. Anything else it wanted to know would be a book word in a generic table, which is the one
 * thing this seam exists to prevent (build/store-separation.test.mjs refuses it).
 *
 * The other half of the seam is the supplier: a kind declares which artefacts it PRODUCES, a
 * supplier declares which it NEEDS, and the two are matched when a shop is configured rather than
 * when somebody tries to buy — a refusal at the till is a refusal too late.
 *
 * AN ORDINARY PRODUCT REGISTERS NO KIND. Not a null column, not a branch: absent.
 */

/* the kit's own. A site adds its own through `store.kinds` in platformkit.config.js, and the
   registry walks both as one list — nothing downstream knows which it came from. */
import { apparel } from './apparel.js'
const KIT = [apparel]

/* what a kind must be, checked once when it is registered rather than discovered at a call site */
const SHAPE = {
  key: 'a slug naming this kind',
  produces: 'the artefact names it derives, so a supplier\'s needs can be matched against it',
  options: 'async (offer, ctx) → [{ name, values: [{ value, label? }], from? }]',
  artefacts: 'async (variant, ctx) → a record, or null where there is nothing to derive',
}

export function checkKind(k) {
  const bad = []
  if (!k || typeof k !== 'object') return ['a kind must be a module exporting an object']
  if (typeof k.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(k.key)) bad.push(`key: ${SHAPE.key}`)
  if (!Array.isArray(k.produces)) bad.push(`produces: ${SHAPE.produces}`)
  for (const fn of ['options', 'artefacts']) if (typeof k[fn] !== 'function') bad.push(`${fn}: ${SHAPE[fn]}`)
  /* a kind that reached past its two slots would be the whole problem, so it is said here */
  for (const extra of Object.keys(k)) {
    if (!['key', 'name', 'produces', 'options', 'artefacts'].includes(extra)) {
      bad.push(`${extra}: a kind reaches the store through options() and artefacts() and nothing else`)
    }
  }
  return bad
}

/*
 * The registry. `kinds(site)` is every kind this site has — the kit's, then its own — and a kind
 * that does not keep the shape is refused by name at registration, never halfway through a build.
 */
export function kinds(own = []) {
  const all = [...KIT, ...own]
  for (const k of all) {
    const bad = checkKind(k)
    if (bad.length) throw new Error(`kinds: ${(k && k.key) || 'a kind'} does not keep the shape —\n  ${bad.join('\n  ')}`)
  }
  const seen = new Set()
  for (const k of all) {
    if (seen.has(k.key)) throw new Error(`kinds: two kinds are called ${k.key}`)
    seen.add(k.key)
  }
  return all
}

export const kindOf = (all, key) => all.find((k) => k.key === key) || null

/*
 * WHAT A SUPPLIER NEEDS AND A KIND MAKES, matched now rather than at the till.
 * Answers the missing names, so a refusal can say which artefact rather than "cannot fulfil".
 */
export function unmet(kind, supplier) {
  const makes = new Set((kind && kind.produces) || [])
  return ((supplier && supplier.needs) || []).filter((n) => !makes.has(n))
}

/*
 * IS THIS VARIANT MAKEABLE YET? The one question the store may ask about an artefact record, and
 * the reason it may: a variant whose artefacts have not been derived cannot be sold, and saying
 * which one is missing is the difference between a fixable state and a mystery.
 *
 * `null` artefacts means a kind with nothing to derive, which is ready; an empty object means a
 * kind that should have derived something and has not, which is not.
 */
export function ready(kind, artefacts) {
  const want = (kind && kind.produces) || []
  if (!want.length) return { ready: true, missing: [] }
  const has = artefacts && typeof artefacts === 'object' ? artefacts : {}
  const missing = want.filter((n) => has[n] === undefined || has[n] === null || has[n] === '')
  return { ready: missing.length === 0, missing }
}
