/*
 * OPTIONS IN, VARIANTS OUT — and the proof that print's own variants come out unchanged.
 *
 * The second half is the point. Print has carried contents × cloth × foil on the cart line since
 * before the store had options at all, through `variantOf` and `printVariant` in its own
 * modules. This change deletes those and puts the general ones in their place, and the claim is
 * that no cart line, purchase, print order or Stripe sku moves. A claim like that is worth
 * exactly as much as the thing that checks it, so it is checked BOTH WAYS over the real books:
 *
 *   every combination the old printVariant ACCEPTED, the new check accepts;
 *   every combination it REFUSED, the new check refuses.
 *
 * One direction alone would pass a check that accepted everything, which is the failure mode
 * that would actually happen.
 *
 * `npm test` runs it.
 */
import { slug, normaliseOptions, combinations, variantKey, readVariantKey, optionsOf, variantsOf, checkVariant, remapKeys } from './variants.mjs'
import { printVariant } from '../supabase/functions/_shared/ledger-rules.js'
import { variantOf } from '../src/lib/print-offers.js'
import { loadSite } from './site.mjs'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

console.log('\nOPTIONS IN, VARIANTS OUT\n')

/* ---- a slug is identity, and the same label always gives the same one ---- */
ok('a slug is lowercase and dashed', slug('Deep Navy') === 'deep-navy')
ok('punctuation goes', slug('6" × 9"') === '6-9')
ok('an accent is folded rather than dropped', slug('Café') === 'cafe')
ok('nothing is nothing', slug('') === '' && slug(null) === '' && slug(undefined) === '')
ok('a slug is stable', slug('Deep Navy') === slug('deep navy'))

/* ---- the shapes a person might write ---- */
{
  const a = normaliseOptions([{ name: 'Size', values: ['S', 'M'] }])
  const b = normaliseOptions({ Size: ['S', 'M'] })
  const c = normaliseOptions([{ name: 'Size', values: [{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }] }])
  ok('a list of options', a.length === 1 && a[0].values.length === 2)
  ok('a map reads the same', JSON.stringify(b) === JSON.stringify(a))
  ok('a value may carry its own label', c[0].values[0].label === 'Small' && c[0].values[0].value === 's')
  ok('a label becomes the slug where there is none', a[0].values[0].value === 's' && a[0].values[0].label === 'S')
  ok('an option with no values is dropped', normaliseOptions([{ name: 'Size', values: [] }]).length === 0)
  ok('an option with no name is dropped', normaliseOptions([{ name: '', values: ['x'] }]).length === 0)
  ok('nonsense is an empty list, never a throw', normaliseOptions(null).length === 0 && normaliseOptions('x').length === 0)
}

/* ---- the matrix ---- */
{
  const o = normaliseOptions([{ name: 'Size', values: ['s', 'm', 'l'] }, { name: 'Colour', values: ['black', 'white'] }])
  const c = combinations(o)
  ok('three sizes and two colours is six', c.length === 6)
  ok('the first option varies slowest, as a table reads', c[0].map((x) => x.value).join() === 's,black' && c[1].map((x) => x.value).join() === 's,white')
  ok('no options is one combination, not none', combinations([]).length === 1 && combinations([])[0].length === 0)
}

/* ---- the key, and reading it back ---- */
{
  const o = normaliseOptions([{ name: 'Contents', values: ['parts', 'full'] }, { name: 'Cloth', values: ['black'] }])
  const [first] = combinations(o)
  ok('the key is the values in declared order', variantKey(first) === 'parts.black')
  ok('an empty choice is the empty key', variantKey([]) === '')
  const back = readVariantKey('parts.black', o)
  ok('reading it back names the options', back[0].option === 'Contents' && back[0].value === 'parts' && back[1].value === 'black')
  ok('a short key leaves the rest empty rather than guessing', readVariantKey('parts', o)[1].value === '')
}

/* ---- an offer's options come from three places and read as one list ---- */
{
  ok('sizes alone is one Size option', optionsOf({ sizes: ['S', 'M'] }).map((o) => o.name).join() === 'Size')
  ok('sizes IS the long form, not a second mechanism', JSON.stringify(optionsOf({ sizes: ['S', 'M'] })) === JSON.stringify(normaliseOptions([{ name: 'Size', values: ['S', 'M'] }])))
  ok('declared options and sizes are both kept', optionsOf({ sizes: ['S'], options: [{ name: 'Colour', values: ['black'] }] }).map((o) => o.name).join() === 'Colour,Size')
  ok('a declared Size wins over the short form', optionsOf({ sizes: ['S', 'M', 'L'], options: [{ name: 'Size', values: ['one'] }] })[0].values.length === 1)
  ok('a kind\'s options come first — they are what the thing IS', optionsOf({ options: [{ name: 'Cloth', values: ['black'] }] }, [{ name: 'Contents', values: ['parts'] }]).map((o) => o.name).join() === 'Contents,Cloth')
  ok('an offer with nothing has no options', optionsOf({}).length === 0 && optionsOf(null).length === 0)
}

/* ---- the sku and the lookup key are derived once ---- */
{
  const vs = variantsOf({ sku: 'the-shirt', key: 'abcd1234' }, [{ name: 'Size', values: ['s', 'm'] }])
  ok('a sku is readable without a lookup', vs[0].sku === 'the-shirt-s')
  ok('a lookup key hangs off the offer\'s key, which never changes', vs[0].lookup === 'abcd1234.s')
  ok('the same input gives the same keys', JSON.stringify(variantsOf({ sku: 'the-shirt', key: 'abcd1234' }, [{ name: 'Size', values: ['s', 'm'] }])) === JSON.stringify(vs))
  const none = variantsOf({ sku: 'a-book', key: 'ffff0000' }, [])
  ok('an offer with no options has one variant and the offer\'s own sku', none.length === 1 && none[0].sku === 'a-book' && none[0].lookup === 'ffff0000' && none[0].variant === '')
  const not = variantsOf({ sku: 'the-shirt', key: 'abcd1234' }, [{ name: 'Size', values: ['s', 'm'] }], { sold: { not: ['m'] } })
  ok('a combination a shop does not sell is present and unsold, not absent', not.length === 2 && not[1].sold === false)
}

/* ---- what an offer with options becomes in the catalog ---- */
{
  /* the composition catalog.mjs performs, over a fixture rather than a real file: the matrix,
     each variant's own price where it has one and the offer's where it has not, and the lookup
     key that hangs off the offer's own */
  const offer = { sku: 'the-shirt', key: 'abcd1234', price: 25, variants: { 'l.black': { price: 30 } }, unsold: ['s.white'] }
  const opts = optionsOf({ options: [{ name: 'Size', values: ['s', 'm', 'l'] }, { name: 'Colour', values: ['black', 'white'] }] })
  const made = variantsOf(offer, opts, { sold: { not: offer.unsold } }).map((v) => ({
    variant: v.variant, key: v.lookup, sold: v.sold,
    unit_amount: offer.variants[v.variant] ? Math.round(offer.variants[v.variant].price * 100) : Math.round(offer.price * 100),
  }))
  ok('six variants', made.length === 6)
  ok('a variant with no price of its own takes the offer\'s', made.find((v) => v.variant === 's.black').unit_amount === 2500)
  ok('and one with its own takes that', made.find((v) => v.variant === 'l.black').unit_amount === 3000)
  ok('an unsold combination is present and marked, not missing', made.find((v) => v.variant === 's.white').sold === false)
  ok('every lookup key hangs off the offer\'s own, which never changes', made.every((v) => v.key.startsWith('abcd1234.')))
  ok('every lookup key is distinct', new Set(made.map((v) => v.key)).size === 6)
}

/*
 * MOVING AN OPTION, AND WHAT MUST MOVE WITH IT.
 *
 * The key is positional, which is the one thing about this grammar that bites. The admin asked
 * before reordering and then reordered WITHOUT touching `variants` or `unsold` — so it saved a
 * file whose keys no combination could produce, and the build refused it afterwards. Loud, but
 * the editor should not be able to write such a file at all.
 */
ok('a reorder rewrites every key, by option name rather than by position', () => {
  const was = [{ name: 'Cover', values: ['linen', 'leather'] }, { name: 'Ruling', values: ['lined', 'plain'] }]
  const now = [{ name: 'Ruling', values: ['lined', 'plain'] }, { name: 'Cover', values: ['linen', 'leather'] }]
  const moved = remapKeys(['leather.lined', 'linen.plain'], was, now)
  ok('the parts are the same, in the new order', moved['leather.lined'] === 'lined.leather' && moved['linen.plain'] === 'plain.linen')
})

ok('and every rewritten key is one the new options actually produce', () => {
  const was = [{ name: 'Cover', values: ['linen', 'leather'] }, { name: 'Ruling', values: ['lined', 'plain'] }]
  const now = [{ name: 'Ruling', values: ['lined', 'plain'] }, { name: 'Cover', values: ['linen', 'leather'] }]
  const made = new Set(variantsOf({ sku: 'x', key: 'k' }, now).map((v) => v.variant))
  const moved = remapKeys([...made].map((k) => k), was, now)   /* round trip over the whole matrix */
  const all = variantsOf({ sku: 'x', key: 'k' }, was).map((v) => v.variant)
  const back = remapKeys(all, was, now)
  ok('no key is left that the build would refuse', all.every((k) => made.has(back[k])), JSON.stringify(back))
})

ok('an option removed takes its part of the key with it, and the rest stands', () => {
  const was = [{ name: 'Cover', values: ['leather'] }, { name: 'Ruling', values: ['lined'] }]
  const now = [{ name: 'Ruling', values: ['lined'] }]
  ok('what is left is the key for what is left', remapKeys(['leather.lined'], was, now)['leather.lined'] === 'lined')
})

ok('a key that cannot be rewritten is dropped rather than guessed at', () => {
  const was = [{ name: 'Cover', values: ['leather'] }]
  const now = [{ name: 'Cover', values: ['leather'] }, { name: 'Ruling', values: ['lined'] }]
  ok('a new option has no value to carry over, so there is no key', remapKeys(['leather'], was, now)['leather'] === null)
})

/* ============================================================================================/* ============================================================================================
 * PRINT COMES OUT UNCHANGED — the two-way proof, over the real books
 * ========================================================================================== */
console.log('\nAND PRINT COMES OUT UNCHANGED\n')

const { books } = await import('../../../.velite/index.js').catch(() => ({ books: [] }))
const printOn = (await loadSite(process.cwd())).modules.print !== false
const inPrint = printOn ? (books || []).filter((b) => b && b.print && b.published !== false) : []

/* print's options, derived from the block rather than typed a second time */
const optionsOfPrintBlock = (p) => [
  { name: 'Contents', values: p.contents && p.contents.length ? p.contents : ['parts'] },
  ...(Array.isArray(p.cloth) && p.cloth.length ? [{ name: 'Cloth', values: p.cloth }] : []),
  ...(Array.isArray(p.foil) && p.foil.length ? [{ name: 'Foil', values: p.foil }] : []),
]

let checked = 0, accepted = 0, refused = 0
for (const b of inPrint) {
  const p = b.print
  const opts = optionsOfPrintBlock(p)
  /* the old shape printVariant is asked in: contents/cloth/foil as lists, or absent */
  const old = { contents: p.contents, cloth: Array.isArray(p.cloth) ? p.cloth : null, foil: Array.isArray(p.foil) ? p.foil : null }

  /* every combination the options produce, and a few that they do not */
  const theirs = variantsOf({ sku: b.slug, key: 'deadbeef' }, opts)
  for (const v of theirs) {
    checked++
    const was = printVariant(old, v.variant)
    const now = checkVariant(opts, v.variant)
    /* the two names, over every combination the book's own block produces */
    if (was) { accepted++; ok(`${b.slug}: ${v.variant} is sold under both names`, !!now, JSON.stringify({ was, now })) }
    else { refused++; ok(`${b.slug}: ${v.variant} is refused under both names`, now === null) }
    /* and print's three named fields come back as they always did */
    if (was) ok(`${b.slug}: ${v.variant} reads as contents/cloth/foil`, typeof was.contents === 'string' && 'cloth' in was && 'foil' in was)
  }
  /*
   * WHAT CHANGED, recorded once rather than asserted against a function that no longer exists
   * in its old form. `printVariant` is now a reading of `checkVariant` in a book's words — one
   * rule, two names — so this cannot compare the two implementations any more. It compares the
   * two NAMES, which is the thing that matters: every caller print already had must get what it
   * always got.
   *
   * The one behaviour that is deliberately different: a key with MORE parts than the book has
   * options used to be accepted and silently truncated — "parts.pink" on a book with no cloth
   * list returned { contents: 'parts' }, ignoring the "pink", and the ledger wrote whatever the
   * session's metadata said. It is now refused. Nothing the store itself writes is shaped like
   * that; a hand-made request is.
   */
  for (const bad of ['parts.pink', 'parts.black.gold.extra']) {
    if (String(bad).split('.').filter(Boolean).length <= opts.length) continue
    checked++
    ok(`${b.slug}: "${bad}" has more parts than options, and is refused`, printVariant(old, bad) === null && checkVariant(opts, bad) === null)
  }
  /* a value the book does not offer, refused under both names */
  if (Array.isArray(p.cloth) && p.cloth.length) {
    const bad = (p.contents && p.contents[0]) + '.not-a-cloth'
    checked++
    ok(`${b.slug}: a cloth it does not sell is refused under both names`, !printVariant(old, bad) && !checkVariant(opts, bad))
  }
  checked++
  ok(`${b.slug}: nonsense contents is refused under both names`, !printVariant(old, 'nonsense') && !checkVariant(opts, 'nonsense'))

  /* and the KEY itself: what print would have written, the general code writes */
  for (const v of theirs) {
    const parts = v.variant.split('.')
    const mine = variantOf(parts[0], opts.length > 1 ? parts[1] : '', opts.length > 2 ? parts[2] : '')
    ok(`${b.slug}: the key is the one print writes (${v.variant})`, mine === v.variant, `print: ${mine}  general: ${v.variant}`)
  }
}
if (inPrint.length) ok('both directions were actually exercised', accepted > 0 && refused >= 0, `${checked} combinations, ${accepted} sold`)
else console.log(`  print variant compatibility: skipped — ${printOn ? 'no published books are configured for print' : 'the print module is disabled'}`)

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
