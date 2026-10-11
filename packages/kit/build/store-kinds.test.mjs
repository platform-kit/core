/*
 * THE SEAM A KIND REACHES THE STORE THROUGH.
 *
 * Two slots and an opaque record (build/kinds/index.js). What is being pinned is not that the
 * functions work — they are twenty lines — but that the SHAPE holds: a kind cannot reach past
 * its two slots, a supplier's needs are matched against what a kind makes BEFORE anything is on
 * sale, and a variant whose artefacts are not derived is not for sale and says which is missing.
 *
 * Driven against a fixture kind for a thing the kit does not sell, on purpose: if the seam only
 * fits books and garments it is not a seam.
 *
 * `npm test` runs it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { kinds, kindOf, checkKind, unmet, ready } from './kinds/index.js'
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

console.log('\nA KIND REACHES THE STORE THROUGH TWO SLOTS\n')

/* a kind for something the kit has never sold: a framed print, which is made by a framer from a
   picture at a size, and has nothing whatever to do with books or shirts */
const framed = {
  key: 'framed-print',
  name: 'A framed print',
  produces: ['artwork', 'mount'],
  async options(offer) {
    return [
      { name: 'Size', values: [{ value: 'a4' }, { value: 'a3' }, { value: 'a2' }] },
      { name: 'Frame', values: [{ value: 'oak' }, { value: 'black' }] },
    ]
  },
  async artefacts(variant) {
    return { artwork: `art/${variant.sku}.tif`, mount: variant.option_values?.Size === 'a2' ? 'wide' : 'standard' }
  },
}

/* ---- the registry ---- */
{
  const all = kinds([framed])
  ok('a site\'s own kind is registered beside the kit\'s', all.length >= 1 && !!kindOf(all, 'framed-print'))
  ok('an unknown key is null, never a throw', kindOf(all, 'nothing-like-this') === null)
  ok('no kind is registered twice', (() => { try { kinds([framed, { ...framed }]); return false } catch (e) { return /two kinds are called/.test(e.message) } })())
  ok('a kind that does not keep the shape is refused BY NAME', (() => {
    try { kinds([{ key: 'broken', produces: [] }]); return false } catch (e) { return /broken/.test(e.message) && /options/.test(e.message) }
  })())
}

/* ---- the two slots, and no third ---- */
{
  ok('a kind reaching past its slots is refused', checkKind({ ...framed, query: () => {} }).some((m) => /nothing else/.test(m)))
  ok('and the refusal names the thing it will not take', checkKind({ ...framed, query: () => {} }).some((m) => /^query:/.test(m)))
  /* the two slots are all the store calls, which is the whole claim */
  const called = []
  const watched = new Proxy(framed, { get(t, k) { if (typeof t[k] === 'function') called.push(k); return t[k] } })
  await watched.options({})
  await watched.artefacts({ sku: 'x' })
  ok('the store calls options() and artefacts() and nothing else', called.sort().join(',') === 'artefacts,options', called.join(','))
}

/* ---- the options a kind supplies are ordinary options ---- */
{
  const opts = await framed.options({ sku: 'a-print' })
  ok('a kind supplies options with values', opts.length === 2 && opts[0].values.length === 3)
  ok('nothing in them says which kind produced them', !JSON.stringify(opts).includes('framed') && !JSON.stringify(opts).includes('kind'))
}

/* ---- the artefact record is opaque, and `ready` is the only question ---- */
{
  const art = await framed.artefacts({ sku: 'a-print-a4-oak', option_values: { Size: 'a4' } })
  ok('a kind derives a record per variant', !!art.artwork && !!art.mount)

  ok('a variant with every artefact is ready', ready(framed, art).ready === true)
  const half = ready(framed, { artwork: 'art/x.tif' })
  ok('a variant missing one is not ready', half.ready === false)
  ok('and it says WHICH is missing, so the state is fixable', half.missing.join() === 'mount', JSON.stringify(half))
  ok('an empty record is not ready', ready(framed, {}).missing.length === 2)
  ok('null artefacts are not ready for a kind that produces something', ready(framed, null).ready === false)
  /* a kind with nothing to derive — an ordinary product's absent kind — is always ready */
  ok('a kind that derives nothing is always ready', ready({ produces: [] }, null).ready === true)
  ok('and so is no kind at all', ready(null, null).ready === true)
}

/* ---- a supplier's needs are matched against what a kind makes, at configuration ---- */
{
  const framer = { key: 'the-framer', needs: ['artwork', 'mount'] }
  const bookPrinter = { key: 'lulu', needs: ['interior', 'cover'] }
  ok('a supplier that can make this kind has nothing unmet', unmet(framed, framer).length === 0)
  ok('a supplier that cannot is refused, naming the artefacts', unmet(framed, bookPrinter).sort().join() === 'cover,interior')
  ok('a supplier that needs nothing takes anything', unmet(framed, { needs: [] }).length === 0)
  ok('a supplier with no needs declared takes anything', unmet(framed, {}).length === 0)
  /* the refusal is about the PAIR, so it reads the same whichever side is wrong */
  ok('a kind that produces nothing meets no needs', unmet({ produces: [] }, framer).length === 2)
}

/* ──────────── A PRODUCT TYPE CANNOT BE INVENTED ────────────
 *
 * The point of the kind seam, not a Printify detail. A product type is the supplier's fact, so
 * there must be no way for an editor to get one into a file — the admin offers a list and the
 * file keeps an id. A typo must not be able to become an order, which means it is refused in
 * every one of the three places a file can reach the shop, IN THE SAME WORDS, because a check
 * written three times is three checks that drift.
 */
{
  const { checkBlueprint, checkValues, apparel, blueprintOf } = await import('./kinds/apparel.js')
  const SELLS = [{ id: 5, title: 'Tee' }, { id: 49, title: 'Hoodie' }]

  ok('a type the supplier sells is accepted', checkBlueprint({ blueprint: 5 }, SELLS) === null)
  const made = checkBlueprint({ blueprint: 999 }, SELLS)
  ok('a made-up type is refused BY NAME', /999/.test(made || ''), made)
  ok('and the refusal says what it does sell', /5, 49/.test(made || ''), made)
  ok('a file naming no type at all is refused differently', /names no product type/.test(checkBlueprint({}, SELLS) || ''))
  ok('a supplier that publishes no catalogue cannot vouch for one', /publishes no catalogue/.test(checkBlueprint({ blueprint: 5 }, []) || ''))

  /* and one level down: a value the type is not made in, named */
  const AXES = [{ name: 'Colour', values: [{ value: 'black' }, { value: 'white' }] }]
  ok('a colour the type is made in passes', checkValues([{ name: 'Colour', values: ['black'] }], AXES) === null)
  const red = checkValues([{ name: 'Colour', values: ['red'] }], AXES)
  ok('a colour it is not made in is refused WITH THE VALUE', /Colour red/.test(red || ''), red)
  ok('a shop\u2019s own axis is left alone', checkValues([{ name: 'Gift wrap', values: ['yes'] }], AXES) === null)

  /* ── the three places, each asking the same function ── */
  const files = (rel) => fs.readFileSync(path.join(KIT, rel), 'utf8')
  ok('AT THE BUILD: the catalog asks it', /checkBlueprint/.test(files('build/catalog.mjs')))
  ok('AT THE SAVE: the products model asks it', /checkBlueprint/.test(files('build/models/core/collections.mjs')))
  ok('AT THE TILL: the checkout refuses a type that is not the supplier\u2019s',
    /no product type|not taken from the supplier/.test(files('supabase/functions/create-checkout-session/index.ts')))
  /* and the till does it without asking anybody, which is the rule a product page lives by */
  const till = files('supabase/functions/create-checkout-session/index.ts')
  ok('and the till fetches nothing to do it', !/await fetch\(.*printify|catalogue\(/i.test(till))

  /* the kind itself keeps the shape, and produces what a garment printer needs */
  ok('the apparel kind keeps the shape', checkKind(apparel).length === 0)
  ok('it produces the artwork a garment printer asks for', apparel.produces.includes('artwork'))
  ok('and a mockup, which is what a buyer sees', apparel.produces.includes('mockup'))
  ok('a blueprint is read as a number, and an absent one as null', blueprintOf({ blueprint: '5' }) === 5 && blueprintOf({}) === null)
}

/* ──────────── AND NOTHING WAITS ON A SUPPLIER ────────────
 *
 * The three shapes, answered by where the fetching happens rather than by a claim:
 *
 *   static  the store is off, so there is nothing to fetch and no supplier to ask;
 *   git     the ADMIN'S refresh asks, and writes the answer into the file;
 *   cloud   nothing builds — and the refresh is the admin FUNCTION there, so it asks in exactly
 *           the same place. A shop that adds a colour in cloud mode has its mockup without a
 *           deploy, because nothing was ever waiting on one.
 *
 * Which leaves one thing to hold: NOTHING ASKS AT REQUEST TIME. A product page that waited on a
 * print-on-demand API would be a page that is slow when the API is slow and broken when it is
 * down, for a fact that changes once a month.
 */
{
  const reads = (rel) => { try { return fs.readFileSync(path.join(KIT, rel), 'utf8') } catch { return '' } }
  /* what runs when somebody asks for a page or buys something */
  const RUNTIME = [
    'supabase/functions/create-checkout-session/index.ts',
    'supabase/functions/_shared/offers.ts',
    'supabase/functions/_shared/ledger.ts',
    'supabase/functions/_shared/ledger-rules.js',
    'supabase/functions/_shared/variants.js',
    'src/lib/storefront.js',
    'src/lib/commerce.js',
    'src/lib/cart.js',
  ]
  const asking = RUNTIME.filter((rel) => /\.catalogue\(|\.mockups\(|\.types\(/.test(reads(rel)))
  ok('nothing on the request path asks a supplier anything', asking.length === 0, asking.join(', '))

  /* and the things that DO ask are the admin's, which is a function in cloud and a dev server in
     git — the same place in both, which is why neither needs a build */
  ok('the refresh is where the asking happens', /x\.catalogue\(/.test(reads('build/models/core/collections.mjs')))
  ok('and the mockups come with it, not from a build step', /x\.mockups\(/.test(reads('build/models/core/collections.mjs')))
  ok('the build itself asks nobody', !/\.catalogue\(|\.mockups\(/.test(reads('build/catalog.mjs')))
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
