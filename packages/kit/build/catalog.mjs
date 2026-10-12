#!/usr/bin/env node
/*
 * The catalog, from the product files — content/store/products/*.md is the source
 * of truth for what is sold, and this writes it where the edge functions can read
 * it: supabase/functions/_shared/catalog.json (committed; build/deploy.mjs runs
 * this before `functions deploy`, as it does the chat's email strings). The
 * checkout function looks a bought sku up here, never in Stripe, and makes Stripe
 * match (offers.ts); the Stripe webhook reads a purchase's kind and book here; the
 * cal.com webhook reads the sessions here — which event type is whose, and how
 * many a week or a month — to refuse a booking a membership does not allow.
 *
 * It also checks what a file can get wrong, and refuses to write on an error:
 * a sku that is not a slug or is used twice, a price missing or negative, a
 * subscription without a period, a membership without a tier and rank, two
 * memberships whose tier and rank disagree, and a session (content/sessions)
 * that requires a tier no membership declares, and nothing that ships without a
 * shipping rate (the storefront's `shipping` list, carried here for Checkout). A book in print (the `print`
 * block on the book, src/lib/print-offers.js) is an offer per format here — print for what
 * ships, download for a file — refused without a key or a line saying on what rights it is
 * printed, and left out (with a note) while a markup has no quote to sit on.
 *
 *   node build/catalog.mjs          # write catalog.json
 *   node build/catalog.mjs --check  # check only (npm test)
 */
/* NOTHING HERE OPENS A DISK AT IMPORT. The admin's pipe reaches this module — an Edge Function
   compiles it where the deployment cannot rebuild — and the pipe's guard refuses a `node:fs` import
   for exactly that reason. What writes files is the script at the foot, which loads fs when it runs. */
import { asStore } from './store/index.mjs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { formatOffers, spineWords, SPINE_MAX, printSpec, formatKey, FORMATS } from '../src/lib/print-offers.js'
import { optionsOf, variantsOf } from './variants.mjs'
import { checkBlueprint } from './kinds/apparel.js'

/* WHICH PAYMENT METHODS A SHOP MAY ACCEPT, named in one place. Deliberately only the ones Checkout
   completes the way a card does: the buyer pays and the session is paid. Anything with a redirect,
   a mandate or a payment that confirms days later changes what "paid" means to the ledger and the
   print job, so it is refused here rather than half-supported — see the audit's "not wanted" row. */
export const PAYMENT_METHODS = ['card', 'link', 'apple_pay', 'google_pay', 'cashapp', 'amazon_pay', 'alipay', 'wechat_pay']
/* the product types the supplier sells, where this run has them. The build does not reach the
   network for them — the admin's refresh does, and the file then holds axes marked with whose
   catalogue they came from, which is the half that CAN be checked offline. null means "not
   checked this run", which is a different thing from "no types". */
const APPAREL_TYPES = null
import { shippingRules } from '../src/lib/shipping.js'
import { printWords, SPINE_EDITION } from './print/words.mjs'
import { uiScope } from './strings-io.mjs'
import { problems as repeatProblems } from '../src/lib/recurrence.js'
import { usageOf } from './site.mjs'

const OUT_AT = 'supabase/functions/_shared/catalog.json'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const USAGE_SCALE = 1_000_000

export function compileUsage(file, usage, billing, err) {
  if (usage == null) return null
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    err(`${file}: usage must be a group of fields`)
    return null
  }
  const unit = String(usage.unit || '').trim()
  if (!unit) err(`${file}: usage.unit names the site's usage unit`)
  const micros = (value, field, { positive = false } = {}) => {
    const n = Number(value)
    const scaled = Math.round(n * USAGE_SCALE)
    if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0) || !Number.isSafeInteger(scaled) || Math.abs(scaled / USAGE_SCALE - n) > 1e-9) {
      err(`${file}: usage.${field} must be ${positive ? 'positive' : 'zero or more'} and use at most six decimal places`)
      return 0
    }
    return scaled
  }
  const out = { unit, rate_micros: micros(usage.rate, 'rate', { positive: true }) }
  if (usage.speechCostPerSecond != null) out.speech_cost_per_second_micros = micros(usage.speechCostPerSecond, 'speechCostPerSecond')

  if (billing === 'once') {
    if (!Number.isInteger(usage.grant) || usage.grant < 1) err(`${file}: a one-time usage offer needs a whole-number usage.grant`)
    else out.grant_micros = usage.grant * USAGE_SCALE
    for (const field of ['included', 'meter', 'overagePrice']) if (usage[field] != null) err(`${file}: usage.${field} is for a metered subscription, not a one-time offer`)
    return out
  }

  if (usage.grant != null) err(`${file}: usage.grant is for a one-time usage offer`)
  const meter = String(usage.meter || '')
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(meter)) err(`${file}: usage.meter must be a lower-case Stripe event name of at most 100 characters`)
  else out.meter = meter
  const included = usage.included == null ? 0 : Number(usage.included)
  if (!Number.isInteger(included) || included < 0 || !Number.isSafeInteger(included * USAGE_SCALE)) err(`${file}: usage.included must be a non-negative whole number of units`)
  else out.included_micros = included * USAGE_SCALE
  out.overage_price_micros = micros(usage.overagePrice, 'overagePrice', { positive: true })
  return out
}

/* THE FOLDERS IT READS, pulled in through the store before anything is worked out.
   Everything below this is the compile as it always was: the same straight line over the same
   records, synchronous. What changed is where the records come from — a checkout on a machine, the
   rows of `public.content` in an Edge Function — because a deployment that never builds again has
   to be able to compile a catalog from the only copy it has. */
const DIRS = ['content/store/products', 'content/books', 'content/sessions', 'content/teams']
async function load(st) {
  const cache = {}
  for (const dir of DIRS) {
    /* the store answers names without the extension; a folder the site does not have answers
       nothing. Only the LISTING is allowed to fail that way — a file that lists and will not read is
       a fault worth hearing about, not an empty catalog. */
    let names = []
    try { names = (await st.list(dir, { ext: 'md' })).filter((n) => !n.includes('/')).sort() } catch { names = [] }
    const out = []
    for (const n of names) { const at = dir + '/' + n + '.md'; out.push({ file: at, data: matter(await st.read(at)).data }) }
    cache[dir] = out
  }
  return cache
}
const text = async (st, at) => { try { return await st.read(at) } catch { return null } }

export async function compileCatalog({ store: from, root = process.cwd(), theme = null, brand = null, site = null } = {}) {
const ROOT = root
const st = asStore(from || root)
const CACHE = await load(st)
const STOREFRONT = await text(st, 'content/store/storefront.md')
const PRINT_JSON = await text(st, 'content/store/print.json')
const EVENTS_JSON = await text(st, '.velite/events.json')
/* THE EVENTS, WHERE THERE IS NO BUILD TO HAVE COMPILED THEM. `.velite/events.json` is a build
   artefact and a store holding rows has none, so the records are read as they are written — the same
   four fields this uses, off the files themselves. A place at an event is an offer like anything
   else, and a deployment that never builds would otherwise stop selling them. */
const EVENTS_MD = await (async () => {
  const out = []
  let names = []
  try { names = (await st.list('content/events', { ext: 'md' })).filter((n) => !n.includes('/')) } catch { return out }
  for (const n of names) {
    const d = matter(await st.read('content/events/' + n + '.md')).data || {}
    out.push({ slug: n, title: d.title, cost: d.cost, published: d.published })
  }
  return out
})()
const errors = []
const err = (m) => errors.push(m)
const siteUsage = usageOf(site || {})

const files = (dir) => CACHE[dir] || []
/* the published teams, so a type naming one that is gone is refused here rather than at nine on a
   Tuesday; a site with no teams folder simply has none */
const teamSlugs = new Set((() => {
  try { return files('content/teams').filter(({ data }) => data.published !== false).map(({ file }) => file.replace(/^.*\//, '').replace(/\.md$/, '')) } catch { return [] }
})())

/* the offers */
const offers = {}
const tiers = {}   /* tier → rank, from the memberships */
for (const { file, data: d } of files('content/store/products')) {
  if (d.published === false) continue
  const sku = String(d.sku || '')
  if (!SLUG.test(sku)) { err(`${file}: sku "${sku}" is not a slug (lower-case words joined by hyphens)`); continue }
  if (offers[sku]) { err(`${file}: sku "${sku}" is already ${offers[sku].file}'s`); continue }
  const key = String(d.key || '')
  if (!/^[0-9a-f]{8}$/.test(key)) { err(`${file}: no key — node build/product-keys.mjs gives it one`); continue }
  const twin = Object.values(offers).find((o) => o.key === key)
  if (twin) { err(`${file}: key ${key} is already ${twin.file}'s`); continue }
  const billing = d.billing === 'subscription' ? 'subscription' : 'once'
  const price = Number(d.price)
  if (!(typeof d.price === 'number' || /^\d+(\.\d{1,2})?$/.test(String(d.price ?? ''))) || !(price >= 0)) err(`${file}: price "${d.price}" — write dollars: 10 or 10.00`)
  if (billing === 'subscription' && !['weekly', 'monthly'].includes(d.period)) err(`${file}: a subscription needs period: weekly | monthly`)
  if (billing === 'once' && d.period) err(`${file}: period is for a subscription; this is bought once`)
  /* THE FOUR STRIPE ALREADY DOES. Each refused HERE, where the build can say which file and which
     field, rather than by Stripe in front of a buyer. A trial on a one-off is the one that would
     actually be rejected by the API; the others are shapes a file can get wrong. */
  if (d.trial != null) {
    if (billing !== 'subscription') err(`${file}: trial is for a subscription; this is bought once`)
    else if (!(Number.isInteger(d.trial) && d.trial >= 1)) err(`${file}: trial "${d.trial}" — write whole days: 14`)
  }
  for (const m of d.payments || []) {
    if (!PAYMENT_METHODS.includes(m)) err(`${file}: payments names "${m}", which is not one Checkout takes like a card — ${PAYMENT_METHODS.join(', ')}`)
  }
  if (d.adjustable) {
    const lo = Number(d.adjustable.min ?? 1), hi = Number(d.adjustable.max ?? 99)
    if (!(Number.isInteger(lo) && lo >= 1)) err(`${file}: adjustable.min "${d.adjustable.min}" — a whole number, one or more`)
    if (!(Number.isInteger(hi) && hi >= lo)) err(`${file}: adjustable.max "${d.adjustable.max}" — a whole number, not below min (${lo})`)
  }
  if (d.kind === 'membership') {
    if (billing !== 'subscription') err(`${file}: a membership is billing: subscription`)
    if (!d.tier || typeof d.rank !== 'number') err(`${file}: a membership needs a tier and a rank`)
    else if (tiers[d.tier] != null && tiers[d.tier] !== d.rank) err(`${file}: tier ${d.tier} has rank ${d.rank} here and ${tiers[d.tier]} elsewhere`)
    else tiers[d.tier] = d.rank
  } else if (d.tier || d.rank != null) err(`${file}: only a membership has a tier and rank`)
  if (d.kind === 'book' && !d.book) err(`${file}: a book unlock names its book`)
  const usage = compileUsage(file, d.usage, billing, err)
  /*
   * A GARMENT'S PRODUCT TYPE IS ITS SUPPLIER'S FACT. The build is the first of the three places a
   * file can reach the shop, and all three refuse it with the same words from the same function
   * (build/kinds/apparel.js) — a check written three times is three checks that drift.
   *
   * The catalogue itself is not fetched here: the build asks the supplier only where it can
   * (`--types`), and otherwise checks what can be checked without the network, which is that the
   * file names a type at all and that its axes came from a catalogue rather than a keyboard.
   */
  if (d.kind === 'apparel') {
    if (!d.supplier) err(`${file}: a garment names the supplier that makes it`)
    const said = checkBlueprint(d, APPAREL_TYPES)
    if (said) err(`${file}: ${said}`)
    const opts0 = optionsOf(d)
    if (opts0.length && !opts0.some((o) => o.from)) err(`${file}: its shapes were typed — a product type's colours and sizes come from the supplier's catalogue (Refresh on the product)`)
  }
  offers[sku] = {
    file, sku, key, title: String(d.title || sku), kind: d.kind, billing, period: billing === 'subscription' ? d.period : null,
    unit_amount: Math.round(price * 100), currency: String(d.currency || 'usd').toLowerCase(),
    tier: d.kind === 'membership' ? d.tier : null, rank: d.kind === 'membership' ? d.rank : null, book: d.kind === 'book' ? d.book : null,
  }
  /* WHAT STRIPE ALREADY DOES, carried only where a file asked for it — so an offer that declares
     none of them has a record byte-identical to the one it had before any of this existed, which
     is what the test asserts rather than hopes. */
  if (billing === 'subscription' && d.trial != null) offers[sku].trial = Number(d.trial)
  if (d.tax && (d.tax.automatic || d.tax.registration)) {
    offers[sku].tax = { ...(d.tax.automatic ? { automatic: true } : {}), ...(d.tax.registration ? { registration: true } : {}) }
  }
  if ((d.payments || []).length) offers[sku].payments = [...d.payments]
  if (d.adjustable) {
    offers[sku].adjustable = { min: Number(d.adjustable.min ?? 1), max: Number(d.adjustable.max ?? 99) }
  }
  if (usage) offers[sku].usage = usage
  /* THE SHAPES THIS IS SOLD IN. Carried on the offer rather than in a file of their own, because
     the checkout function already has the offer and a second lookup is a second thing that can
     be stale. An offer with no options adds nothing here and its record is unchanged. */
  {
    const opts = optionsOf(d)
    if (opts.length) {
      /* WHOSE CATALOGUE AN AXIS CAME FROM travels with it. A garment's axes are its supplier's,
         and an apparel offer whose axes were typed has had its product type invented somewhere —
         which the till can then refuse without asking anybody (create-checkout-session). */
      offers[sku].options = opts.map((o) => ({ name: o.name, values: o.values, ...(o.from ? { from: o.from } : {}) }))
      offers[sku].variants = variantsOf({ sku, key }, opts, { sold: { not: d.unsold || [] } }).map((v) => {
        const own = (d.variants && d.variants[v.variant]) || {}
        /* a variant's own price where it has one, the offer's where it has not — the base every
           variant starts from (see the pricing decision: one mechanism, written short) */
        const amount = own.price != null ? Math.round(Number(own.price) * 100) : offers[sku].unit_amount
        if (own.price != null && !(Number(own.price) >= 0)) err(`${file}: variant "${v.variant}" has a price that is not a number`)
        return { variant: v.variant, sku: own.sku || v.sku, key: v.lookup, unit_amount: amount, label: v.label, sold: v.sold !== false, weight: own.weight ?? null }
      })
      /* a variant named in `variants:` that no combination produces is a typo, and a silent one:
         the price would simply never apply and nobody would know which */
      for (const k of Object.keys(d.variants || {})) {
        if (!offers[sku].variants.some((v) => v.variant === k)) err(`${file}: variants names "${k}", which no combination of its options produces`)
      }
      for (const k of d.unsold || []) {
        if (!offers[sku].variants.some((v) => v.variant === k)) err(`${file}: unsold names "${k}", which no combination of its options produces`)
      }
    }
  }
}
const meterOwners = new Map()
for (const offer of Object.values(offers)) {
  if (!offer.usage?.meter) continue
  const owner = meterOwners.get(offer.usage.meter)
  if (owner) err(`${offer.file}: Stripe meter "${offer.usage.meter}" is already used by ${owner.file}; each metered offer needs its own meter event`)
  else meterOwners.set(offer.usage.meter, offer)
}
/* the editions the build has set (content/store/print.json): which files an order prints, and
   what the printer quoted for one copy of each, which a markup is priced over */
let editions = {}
/* a store answers a missing file with null, and JSON.parse(null) is null rather than a throw —
   so the fallback is explicit here rather than left to the catch */
try { editions = JSON.parse(PRINT_JSON) || {} } catch (e) { /* none yet */ }
/* the books in print: an offer per format, by the rule the storefront shares */
/* through the store: in an Edge Function there is no content directory to open */
const PRINT_WORDS = await printWords(st, theme ? { theme } : {})
for (const { file, data: d } of files('content/books')) {
  if (!d.print || d.published === false) continue
  const slug = file.split('/').pop().slice(0, -3)
  const spec = printSpec(d.print)
  /* no rights line yet: the block is the jacket's copy, and the book is not for sale */
  if (!spec.rights) { console.log(`  ${file}: print has no rights: line — not on sale until it says on what footing the text is printed and sold`); continue }
  if (!spec.key) { err(`${file}: print needs a key (node build/product-keys.mjs gives it one)`); continue }
  const sp = spineWords(d.title, spec.spine, SPINE_EDITION(PRINT_WORDS))
  if (!sp.fits) { err(`${file}: the spine holds ${SPINE_MAX} characters of "${sp.title}" and "${sp.edition}" together — give the print block a spine: of ${sp.room} or fewer`); continue }
  /* the functions need the book's title and each format's key whether or not the format is on
     sale yet (a proof copy may be ordered before it is quoted) */
  if (editions[slug]) editions[slug] = { ...editions[slug], title: d.title, keys: Object.fromEntries(FORMATS.filter((f) => spec.formats[f]).map((f) => [f, formatKey(spec.key, f)])) }
  for (const o of formatOffers({ ...d, slug }, editions[slug])) {
    /* a markup needs the edition's quote to sit on; until the build has set one (deploy does, before this runs) the format is not on sale */
    if (!(o.price > 0)) { console.log(`  ${file}: ${o.format} is priced by markup and no edition has been quoted yet — not on sale until node build/print.mjs --book ${slug} sets one`); continue }
    if (offers[o.sku]) { err(`${file}: sku "${o.sku}" is already ${offers[o.sku].file}'s`); continue }
    const twin = Object.values(offers).find((x) => x.key === o.key)
    if (twin) { err(`${file}: key ${o.key} (${o.format}) is already ${twin.file}'s`); continue }
    offers[o.sku] = { file, sku: o.sku, key: o.key, title: `${d.title} · ${o.format}`, kind: o.kind, billing: 'once', period: null,
      unit_amount: Math.round(o.price * 100), currency: o.currency, tier: null, rank: null, book: slug, format: o.format, binding: o.binding, trim: o.trim, paper: o.paper,
      contents: o.contents, cloth: o.cloth, foil: o.foil, includes: o.includes, printer: o.printer }
  }
}
/* A PLACE AT AN EVENT IS A THING SOMEBODY BUYS, so it is an offer like anything else — otherwise
   the page could ask for money and the checkout would refuse a sku it had never heard of.
   The sku is the file's own (cost.sku) or 'event-<slug>', and that is what the page later looks for
   among somebody's paid purchases before it shows them the address. Nothing is declared twice: the
   price, the currency and the title are the event's, read from the same record the calendar is. */
try {
  const events = JSON.parse(EVENTS_JSON) || EVENTS_MD
  for (const e of events) {
    if (!e.cost || !(Number(e.cost.price) > 0) || e.published === false) continue
    const sku = String(e.cost.sku || ('event-' + e.slug))
    if (offers[sku]) { err(`content/events/${e.slug}.md: sku "${sku}" is already ${offers[sku].file}'s`); continue }
    /* the key is the offer's IDENTITY — what Stripe looks a price up by and what a purchase is
       attributed to — so it must not change when a title or a price does. An event has no writer to
       give it one, so it is derived from the sku the same way a printed format's is from the book's:
       FNV-1a, eight hex, the same answer every time and on every machine. */
    const key = e.cost.key || (() => { let h = 0x811c9dc5; for (const ch of 'event:' + sku) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return (h >>> 0).toString(16).padStart(8, '0') })()
    offers[sku] = { file: `content/events/${e.slug}.md`, sku, key, title: e.title,
      kind: 'event', billing: 'once', period: null,
      unit_amount: Math.round(Number(e.cost.price) * 100), currency: String(e.cost.currency || 'usd'),
      tier: null, rank: null, event: e.slug }
  }
} catch (err2) { /* a site with no events, or none compiled yet */ }

/* where the store ships and what it charges, from the storefront (src/lib/shipping.js) */
const store = matter(STOREFRONT || '').data
/* a store that ships nothing declares no shipping; one that does must declare it whole */
const ships = Object.values(offers).some((o) => o.kind === 'good' || o.kind === 'print')
const { issues: shipIssues, ...shipping } = shippingRules(store.shipping || {})
if (ships || store.shipping) for (const i of shipIssues) err('content/store/storefront.md: shipping — ' + i)
if (Object.values(offers).some((o) => o.kind === 'good' || o.kind === 'print') && !store.shipping) err('content/store/storefront.md: something ships, and no shipping is declared')
/* the words Checkout itself shows, from the store's strings (`## cart / ### checkout` in
   content/app/ui/store.md, merged over the theme's defaults): the line under the pay button — that every copy is made to order
   and the sale is final — carried here so the function never holds a word of its own */
/* the theme's scopes are handed in where the caller has them (an Edge Function, which cannot load
   the theme's manifest off a disk); on a machine uiScope finds them itself */
const words = await (async () => { try { return ((await uiScope('store', st, theme ? { theme } : {})).cart || {}).checkout || {} } catch (e) { return {} } })()
/* what the functions need of an edition: by book, by contents — the files' folder, and per printed
   format who prints it, its product there, its cover files by key (a linen's by colour), a title it
   keeps; the foil, whether an EPUB is there */
editions = Object.fromEntries(Object.entries(editions).map(([slug, b]) => [slug, { title: b.title || slug, keys: b.keys || {}, editions: Object.fromEntries(Object.entries(b.editions || {}).map(([c, e]) => [c, { edition: e.edition, pages: e.pages, printers: Object.fromEntries(Object.entries(e.printers || {}).map(([f, x]) => [f, { provider: x.provider, product: x.product, products: x.products || null, key: x.key, covers: x.covers, ref: x.ref || null }])), epub: !!e.epub, foilStamp: e.foilStamp || null }])) }]))
/* every session's `requires` is anyone, a class, or a tier a membership declares; `below` a tier */
const sessions = []
/* a tier's own allowances: { <tier>: { <type slug>: { weekly, monthly } } } from the membership products' `sessions` rows, checked against the session files */
const allowances = {}
const sessionSlugs = new Set(files('content/sessions').filter(({ data: d }) => d.published !== false).map(({ file }) => String(file).replace(/^.*\//, '').replace(/\.md$/, '')))
for (const { file, data: d } of files('content/store/products')) {
  if (d.published === false || d.kind !== 'membership' || !d.tier) continue
  const rows = Array.isArray(d.sessions) ? d.sessions : []
  for (const r of rows) {
    const type = String((r && r.type) || '')
    if (!type || !sessionSlugs.has(type)) { err(`${file}: sessions included names "${type}", and no published booking type has that slug`); continue }
    if (allowances[d.tier] && allowances[d.tier][type]) { err(`${file}: sessions included lists "${type}" twice for tier ${d.tier}`); continue }
    ;(allowances[d.tier] ||= {})[type] = { weekly: Number(r.weekly) || 0, monthly: Number(r.monthly) || 0 }
  }
}
const eventOf = (href) => { try { return new URL(href).pathname.split('/').filter(Boolean).pop() || '' } catch (e) { return '' } }
const userOf = (href) => { try { const p = new URL(href).pathname.split('/').filter(Boolean); return p.length >= 2 ? p[0] : '' } catch (e) { return '' } }
for (const { file, data: d } of files('content/sessions')) {
  if (d.published === false) continue
  const r = Array.isArray(d.requires) ? d.requires.map(String) : (d.requires || 'guest')
  /* a LIST is exactly those tiers and says nothing about a ladder; a single slug is the shorthand
     for that tier and every higher rank. Either way every tier named must be one a membership
     declares, or the rule admits nobody and nobody would know why. */
  for (const one of Array.isArray(r) ? r : [r]) {
    if (['anyone', 'guest', 'authenticated'].includes(one)) { if (Array.isArray(r)) err(`${file}: requires lists "${one}", which is a class and not a tier — a list is tiers alone`); continue }
    if (tiers[one] == null) err(`${file}: requires "${one}", and no membership product declares that tier (${Object.keys(tiers).join(', ') || 'none'})`)
  }
  if (d.below && tiers[d.below] == null) err(`${file}: below "${d.below}", and no membership product declares that tier`)
  /* who schedules it: the file says, else cal.com when it carries a cal.com url, else the site's own */
  const slug = String(file).replace(/^.*\//, '').replace(/\.md$/, '')
  const scheduler = d.scheduler === 'native' || d.scheduler === 'cal' ? d.scheduler : d.url ? 'cal' : 'native'
  let event = slug, username = null
  if (scheduler === 'cal') {
    event = eventOf(d.url); username = userOf(d.url)
    if (!event || !username) err(`${file}: scheduled by cal.com, and the url is not a cal.com booking page (https://cal.com/<username>/<event-type>)`)
  }
  const duration = Number(d.duration) || 0
  /* A HOST IS AN EMAIL, or a row saying how the rota treats them. The catalog keeps the plain list
     of emails, because that is what everything downstream reads, and the rota beside it — so adding
     a priority to one host cannot change the shape anything else depends on. */
  const given = Array.isArray(d.hosts) ? d.hosts : d.hosts ? [d.hosts] : []
  const rows = given.map((h) => (h && typeof h === 'object' ? { ...h, email: String(h.email || '').toLowerCase() } : { email: String(h).toLowerCase() }))
  for (const r of rows) {
    if (!r.email) err(`${file}: a host with no email`)
    if (r.priority != null && !(Number(r.priority) >= 0 && Number(r.priority) <= 4)) err(`${file}: ${r.email}'s priority is 0 to 4 (2 is the ordinary one)`)
    if (r.weight != null && !(Number(r.weight) > 0)) err(`${file}: ${r.email}'s weight is a percentage above zero (100 is an equal share)`)
  }
  const hosts = rows.map((r) => r.email)
  const rota = rows.filter((r) => r.priority != null || r.weight != null || r.fixed)
    .map((r) => ({ email: r.email, priority: r.priority == null ? 2 : Number(r.priority), weight: r.weight == null ? 100 : Number(r.weight), fixed: !!r.fixed }))
  /* HOW A BOOKING IS SHARED. A single host IS the rota with one name in it, so there is one path. */
  const ASSIGN = ['one', 'round-robin', 'collective', 'managed']
  /* `one` is what a single-host type said before there was a rota; it IS the rota with one name in
     it, so it is written down as one thing rather than two that behave the same */
  const assign = d.assign === 'one' ? 'round-robin' : ASSIGN.includes(d.assign) ? d.assign : 'round-robin'
  if (d.assign && !ASSIGN.includes(d.assign)) err(`${file}: assign "${d.assign}" is not one of ${ASSIGN.join(', ')}`)
  if (d.assign && scheduler !== 'native') err(`${file}: assign is for a type this site schedules — cal.com shares its own`)
  /* A TEAM'S MEMBERS ARE ROWS, so the catalog carries the team's name and the scheduler asks the
     database who is in it at the time. A file that listed them would be a file naming people. */
  /* THE GRID AND THE WINDOW, said as numbers the scheduler can use rather than as the file's shape */
  const interval = Number(d.interval) > 0 ? Math.round(Number(d.interval)) : 0
  const offsetMins = Number(d.offset) > 0 ? Math.round(Number(d.offset)) : 0
  if (interval && (interval < 5 || interval > 240)) err(`${file}: the interval between times is 5 to 240 minutes`)
  if (offsetMins && offsetMins >= (interval || 15)) err(`${file}: the offset is less than the interval between times`)
  let windowDays = 0, windowFrom = null, windowTo = null
  if (typeof d.window === 'number') { windowDays = Math.max(0, Math.round(d.window)) }
  else if (d.window && typeof d.window === 'object') {
    const dayOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (d.window.from && !dayOk(d.window.from)) err(`${file}: the window's from is a day (YYYY-MM-DD)`)
    if (d.window.to && !dayOk(d.window.to)) err(`${file}: the window's to is a day (YYYY-MM-DD)`)
    if (dayOk(d.window.from)) windowFrom = d.window.from
    if (dayOk(d.window.to)) windowTo = d.window.to
    if (windowFrom && windowTo && windowTo < windowFrom) err(`${file}: the window closes before it opens`)
  }
  /* THE BOOKING PAGE'S OWN SWITCHES, kept as written; every one of them is a default that says
     yes, so a type with no block behaves exactly as every type did before there was one. */
  const PAGE = ['redirect', 'notes', 'organiser', 'details', 'zone', 'cancel', 'reschedule', 'past', 'account', 'hidden', 'seatsLeft', 'attendees']
  const page = {}
  for (const [k, val] of Object.entries(d.page || {})) {
    if (!PAGE.includes(k)) { err(`${file}: page "${k}" is not one of ${PAGE.join(', ')}`); continue }
    if (k === 'redirect') { if (val) { if (!/^(https?:\/\/|\/)/.test(String(val))) err(`${file}: the redirect is a url or a path on this site`); else page.redirect = String(val) } continue }
    if (k === 'cancel' || k === 'reschedule') { if (val === 'notice' || val === false || val === true) page[k] = val; else err(`${file}: page.${k} is true, false, or "notice"`); continue }
    if (typeof val === 'boolean') page[k] = val
    else err(`${file}: page.${k} is true or false`)
  }
  const LIMITS = ['day', 'week', 'month', 'year', 'minutesDay', 'minutesWeek']
  const limits = {}
  for (const [k, val] of Object.entries(d.limits || {})) {
    if (!LIMITS.includes(k)) { err(`${file}: "${k}" is not one of ${LIMITS.join(', ')}`); continue }
    const n = Number(val)
    if (!(n >= 0)) { err(`${file}: the limit ${k} is a number`); continue }
    if (n > 0) limits[k] = Math.round(n)
  }
  /* A RUN OF SESSIONS the reader books at once — not `repeats`, which is the type happening at a
     fixed time whether anybody books or not. A type cannot be both: one says the reader chooses how
     many, the other says the calendar already decided. */
  let repeat = null
  if (d.repeat) {
    const n = Number(d.repeat.count), most = Number(d.repeat.most || d.repeat.count)
    const every = ['week', 'month', 'year'].includes(d.repeat.every) ? d.repeat.every : 'week'
    if (!(n >= 2)) err(`${file}: a run is two or more sessions (repeat.count)`)
    else if (!(most >= n)) err(`${file}: repeat.most (${most}) is at least repeat.count (${n})`)
    else if (most > 52) err(`${file}: a run of more than 52 is not a run`)
    else repeat = { count: Math.round(n), every, most: Math.round(most) }
    if (d.repeats) err(`${file}: a type either happens at a fixed time (repeats) or is booked as a run (repeat), not both`)
    if (scheduler !== 'native') err(`${file}: a run is for a type this site schedules`)
    if (Number(d.seats) > 0) err(`${file}: a run of a group session is not a thing anybody has asked for — its times are the group's`)
  }
  /* SEVERAL LENGTHS, each a number of minutes and optionally its own price and sku. The first is
     the default and must be the type's own duration, so a type that says nothing and a type that
     says one length behave the same. */
  const lengths = []
  for (const l of Array.isArray(d.lengths) ? d.lengths : []) {
    const row = typeof l === 'number' ? { minutes: l } : (l && typeof l === 'object' ? { ...l } : null)
    if (!row || !(Number(row.minutes) > 0)) { err(`${file}: a length is a number of minutes`); continue }
    row.minutes = Math.round(Number(row.minutes))
    if (row.sku && !offers[row.sku]) err(`${file}: the ${row.minutes}-minute length is paid as "${row.sku}", and no product file declares that sku`)
    lengths.push(row)
  }
  if (lengths.length && lengths[0].minutes !== duration) err(`${file}: the first length (${lengths[0].minutes}) is the default, so it must be the type's own duration (${duration})`)
  if (lengths.length === 1) lengths.length = 0   /* one length is no choice at all */
  /* WHAT THE BOOKING IS CALLED. Only the four the booking can fill. */
  const NAME_VARS = ['reader', 'host', 'type', 'length']
  const name = d.name ? String(d.name) : null
  if (name) for (const m of name.matchAll(/\{(\w+)\}/g)) if (!NAME_VARS.includes(m[1])) err(`${file}: the name says {${m[1]}}, and only ${NAME_VARS.map((x) => '{' + x + '}').join(', ')} can be filled`)
  /* whether a booking waits for the host's word: always, or only inside the notice */
  let confirm = false
  if (d.confirm === true || d.confirm === 'notice') confirm = d.confirm
  else if (d.confirm !== undefined && d.confirm !== false) err(`${file}: confirm is true, false, or "notice"`)
  if (confirm && scheduler !== 'native') err(`${file}: confirm is for a type this site schedules — cal.com asks its own`)
  const team = d.team ? String(d.team) : null
  if (team && !teamSlugs.has(team)) err(`${file}: names the team "${team}", and no published team file declares it`)
  if (scheduler === 'native' && !hosts.length && !team) err(`${file}: scheduled by this site, and names no host (hosts: the accounts that give it, by email — or team: whose members give it)`)
  if (scheduler === 'native' && !(duration > 0)) err(`${file}: scheduled by this site, and has no length (duration, in minutes)`)
  const KINDS = ['video', 'link', 'place', 'phone', 'none']
  const kind = KINDS.includes(d.where) ? d.where : 'none'
  if (d.where && !KINDS.includes(d.where)) err(`${file}: where "${d.where}" is not one of ${KINDS.join(', ')}`)
  const where = kind === 'link' ? { kind, url: String(d.link || '') } : kind === 'place' ? { kind, name: String(d.place || ''), address: String(d.address || '') } : kind === 'phone' ? { kind, number: String(d.phone || '') } : { kind }
  if (kind === 'link' && !where.url) err(`${file}: happens on a link, and no link is given`)
  if (kind === 'place' && !where.address && !where.name) err(`${file}: happens in person, and no place is given`)
  if (d.record && kind !== 'video') err(`${file}: record is for a session in a video room`)
  /* A TYPE THAT HAPPENS AT A FIXED TIME rather than whenever suits: its occurrences are its
     bookable times, and the hosts' hours are not asked. Refused here rather than at nine on a
     Tuesday, in the same grammar everything else that recurs uses. */
  if (d.repeats) {
    if (scheduler !== 'native') err(`${file}: repeats is for a type this site schedules — cal.com keeps its own calendar`)
    for (const why of repeatProblems(d.repeats)) err(`${file}: ${why}`)
  }
  if (d.sku) { const o = offers[d.sku]; if (!o) err(`${file}: paid as "${d.sku}", and no product file declares that sku`); else if (o.kind !== 'session' || o.billing !== 'once') err(`${file}: "${d.sku}" must be a product of kind session, billing once`) }
  sessions.push({ title: String(d.title || ''), slug, event, scheduler, username, requires: r, below: d.below || null, weekly: Number(d.weekly) || 0, monthly: Number(d.monthly) || 0, sku: d.sku || null, duration, hosts, rota, team, assign, confirm, repeat, lengths, name, page, form: d.form ? String(d.form) : null, interval, offset: offsetMins, windowDays, windowFrom, windowTo, limits, seats: Number(d.seats) || 0, buffer: Number(d.buffer) || 0, schedule: d.schedule || null, notice: d.notice == null ? 24 : Number(d.notice) || 0, where, record: !!d.record, hours: d.hours || null, repeats: d.repeats || null })
}

  const list = Object.values(offers).map(({ file, ...o }) => o)
  /* THE THREE FACES THE SITE SETS, beside the words and for the same reason: what a function needs
     in order to render something in the site's own voice travels with the catalog. The share-image
     function draws the card where no browser can photograph the real one, and a card set in the
     wrong type is not the site's card. */
  /* THE FACES AND THE MARK COME IN, they are not read here. Both are the theme's and the look's —
     CSS tokens and a component, code rather than content — so they cannot change on a publish and
     must not be looked for on a disk the Edge Function does not have. The caller hands them over:
     on a machine build/fonts.mjs reads them, and in the function the assembler's
     pipe/theme-brand.json does, exactly as the theme's strings arrive. */
  const fonts = (brand && brand.fonts) || { body: null, display: null, mono: null }
  const mark = (brand && brand.mark) || null
  /* the colour the MARK is drawn in, which is not the colour of the words beside it: SiteMark's
     stroke is the accent, and tinting both to the row's grey makes the card look like another
     site's. The light one, since the card is drawn in the light theme. */
  const accent = (brand && brand.accent) || null
  const bySku = Object.fromEntries(list.map((o) => [o.sku, o]))
  /*
   * THE PRICE LISTS, INCLUDING THE SHOP’S OWN, so the function and the page both read lists and
   * neither has a case for "the price on the variant". A list that has not opened or has closed
   * is still carried — `priceOf` decides by the clock at the moment it is asked, and a list
   * dropped at build time could not open on the day it was written for.
   */
  const priceFiles = []
  for (const f of await st.list('content/store/prices', { ext: 'md' }).catch(() => [])) {
    const raw = await text(st, 'content/store/prices/' + f + '.md')
    if (!raw) continue
    const { data } = matter(raw)
    if (data && data.published !== false) priceFiles.push({ ...data, path: f })
  }
  /* the discounts, which are not prices and are read as their own thing */
  const promoFiles = []
  for (const f of await st.list('content/store/promotions').catch(() => [])) {
    const raw = await text(st, 'content/store/promotions/' + f)
    if (!raw) continue
    const { data } = matter(raw)
    if (data && data.published !== false) promoFiles.push({ ...data, name: String(f).replace(/[.]md$/, '') })
  }
  const lists = priceLists(bySku, priceFiles)
  for (const [operationId, policy] of Object.entries(siteUsage.operations || {})) {
    if (policy.mode !== 'offer') continue
    const offer = Object.values(offers).find((candidate) => candidate.key === policy.offerKey)
    if (!offer) err(`usage.operations.${operationId}: no published offer has key ${policy.offerKey}`)
    else if (!offer.usage) err(`${offer.file}: usage.operations.${operationId} names an offer without usage billing`)
  }
  for (const priceList of lists) {
    for (const price of priceList.prices || []) {
      const offer = bySku[price.sku]
      if (offer?.billing === 'subscription' && offer.usage?.meter && price.currency !== offer.currency) {
        err(`${priceList.name}: metered offer "${offer.sku}" cannot have an alternate currency; its base and metered prices must use the same currency`)
      }
    }
  }
  let usageAutoTopUp
  const autoTopUp = site?.usage?.autoTopUp
  if (autoTopUp != null) {
    if (!autoTopUp || typeof autoTopUp !== 'object' || Array.isArray(autoTopUp)) {
      err('usage.autoTopUp must be a group of fields')
    } else {
      const packKeys = autoTopUp.packKeys ?? []
      if (autoTopUp.enabled != null && typeof autoTopUp.enabled !== 'boolean') err('usage.autoTopUp.enabled must be true or false')
      if (!Array.isArray(packKeys) || packKeys.some((key) => typeof key !== 'string' || !/^[0-9a-f]{8}$/.test(key))) {
        err('usage.autoTopUp.packKeys must be stable eight-character offer keys')
      } else {
        if (new Set(packKeys).size !== packKeys.length) err('usage.autoTopUp.packKeys cannot repeat an offer key')
        const packs = []
        for (const key of [...new Set(packKeys)]) {
          const pack = Object.values(offers).find((candidate) => candidate.key === key)
          if (!pack) {
            err(`usage.autoTopUp.packKeys: no published offer has stable key ${key}`)
            continue
          }
          if (pack.billing !== 'once' || !pack.usage?.grant_micros) {
            err(`${pack.file}: automatic top-up requires a one-time offer that grants usage units`)
            continue
          }
          packs.push({
            key: pack.key, sku: pack.sku, title: pack.title, unit_amount: pack.unit_amount,
            currency: pack.currency, units_micros: pack.usage.grant_micros, unit: pack.usage.unit,
            rate_micros: pack.usage.rate_micros,
            speech_cost_per_second_micros: pack.usage.speech_cost_per_second_micros || 0,
          })
        }
        const currencies = new Set(packs.map((pack) => pack.currency))
        if (autoTopUp.enabled === true && packs.length === 0) err('usage.autoTopUp needs at least one eligible prepaid usage pack')
        if (autoTopUp.enabled === true && currencies.size > 1) err('usage.autoTopUp packs must use one currency so the reader’s monthly cap has an unambiguous value')
        usageAutoTopUp = {
          enabled: autoTopUp.enabled === true,
          currency: currencies.size === 1 ? [...currencies][0] : null,
          packs,
        }
      }
    }
  }
  if (errors.length) { const e = new Error('catalog:\n  ' + errors.join('\n  ')); e.faults = errors; throw e }
  return {
    offers: bySku, lists, promotions: promotions(promoFiles), tiers, allowances, sessions, shipping, editions, words, fonts, mark, accent,
    ...(usageAutoTopUp ? { usage_auto_topup: usageAutoTopUp } : {}),
  }
}

/* the script's own write-if-changed: inline, because anything this module names — even in a
   dynamic import — is assembled into the pipe, and the pipe may not reach a disk */
async function writer() {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  return (at, text) => {
    try { if (readFileSync(at, 'utf8') === text) return false } catch { /* not there yet */ }
    mkdirSync(at.replace(/\/[^/]*$/, ''), { recursive: true })
    writeFileSync(at, text)
    return true
  }
}

/* the script: the same compile over the checkout, written where the functions read it */
if (import.meta.url === `file://${process.argv[1]}`) {
  const write = await writer()
  /* on a machine the theme is there to read: the faces the looks set and the mark, handed to the
     compile rather than looked for inside it (see `brand` above) */
  const brand = await (async () => {
    try { const m = await import('./fonts.mjs'); return { fonts: await m.fontsOf(), mark: await m.markOf(process.cwd(), { size: 26, stroke: '__STROKE__' }), accent: await m.accentOf() } }
    catch { return null }
  })()
  const site = await (await import('./site.mjs')).loadSite()
  const out = await compileCatalog({ brand, site }).catch((e) => { console.error('✖ ' + e.message); process.exit(1) })
  const n = Object.keys(out.offers).length
  if (process.argv.includes('--check')) { console.log(`✔ catalog: ${n} offers, tiers ${Object.keys(out.tiers).join(' ') || '—'}`); process.exit(0) }
  write(join(process.cwd(), OUT_AT), JSON.stringify(out, null, 2) + '\n')
  console.log(`✔ catalog: ${n} offers → ` + OUT_AT)
}

/*
 * THE PRICE LISTS, INCLUDING THE SHOP’S OWN.
 *
 * An offer’s prices are compiled into a list like any other — the BASE list — so
 * `priceOf()` walks lists and never has a special case for "the price on the variant". There
 * is no such thing by the time it runs. A shop that writes one number beside a variant never
 * learns the word; the general mechanism with the common case written short, as the strings
 * and the looks already are.
 */
export function priceLists(offers, records) {
  const prices = []
  for (const o of Object.values(offers || {})) {
    if (!o || !o.sku) continue
    if (Array.isArray(o.variants) && o.variants.length) {
      for (const v of o.variants) prices.push({ sku: o.sku, variant: v.variant, amount: v.unit_amount, currency: o.currency || 'usd' })
    } else if (o.unit_amount != null) prices.push({ sku: o.sku, variant: '', amount: o.unit_amount, currency: o.currency || 'usd' })
  }
  const base = { name: 'base', kind: 'base', rules: [], priority: 0, prices }
  /* and whatever the shop has written beside it, in whole money as a file says it */
  const further = (records || []).filter((r) => r && r.published !== false).map((r) => ({
    name: r.path || r.title, kind: r.kind, status: r.status || 'active', rules: r.rules || [], priority: Number(r.priority) || 0,
    starts: r.starts || null, ends: r.ends || null,
    prices: (r.prices || []).map((x) => ({
      sku: x.sku, variant: x.variant || '', amount: Math.round(Number(x.amount) * 100),
      currency: String(x.currency || r.currency || 'usd').toLowerCase(),
      ...(x.min_quantity != null ? { min_quantity: x.min_quantity } : {}),
      ...(x.max_quantity != null ? { max_quantity: x.max_quantity } : {}),
    })),
  }))
  return [base, ...further]
}
/* the promotions, as the resolver wants them: money in pence, everything else as written */
export function promotions(records) {
  return (records || []).filter((r) => r && r.published !== false).map((r) => ({
    name: r.name || r.title, title: r.title, kind: r.kind || 'standard', status: r.status || 'active',
    method: r.method || 'percentage', value: Number(r.value) || 0,
    target: r.target || 'items', allocation: r.allocation || 'each',
    ...(r.max_quantity != null ? { max_quantity: Number(r.max_quantity) } : {}),
    applies: r.applies || [], rules: r.rules || [],
    starts: r.starts || null, ends: r.ends || null,
    ...(r.budget ? { budget: r.budget } : {}),
  }))
}