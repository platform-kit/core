/*
 * THE SUPPLIER CONTRACT — every supplier wears the same shape, and nothing outside its own file
 * knows its name.
 *
 * A supplier MAKES A VARIANT OUT OF ARTEFACTS, and that is the whole vocabulary. Not a page
 * count, not an interior, not a trim: a book’s page count is one of a book’s artefacts and the
 * supplier is handed it along with everything else the kind produced. The interface used to say
 * `pages` and `files` outright, which meant a supplier that makes anything but a book could not
 * implement it — and the claim that printers were "plug-in" was true only of printers.
 *
 * So three things are pinned here. The SHAPE: every supplier answers the whole interface
 * `suppliers/index.js` declares, its `levels` speak our three shipping words, and its `statusOf`
 * lands in our vocabulary and nowhere else. The VOCABULARY: no method takes a word belonging to
 * one kind of thing, checked against the source rather than by reading. And the SEAM: no module
 * outside `_shared/suppliers/` names a supplier id, so `providersFor` really is the only way one
 * is chosen.
 *
 * A plug-in seam is exactly the thing that rots quietly: a caller reaches past the interface for
 * one field only Lulu has, it works, and the seam is a seam in name only until somebody adds a
 * fourth supplier and finds out.
 *
 * Every call here is offline. A supplier with no keys is mocked by construction, which is the
 * property that lets the whole chain run with no account — so it is also what makes this cheap.
 *
 * Run alone:  node packages/kit/build/suppliers.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { printers, PRINTER_IDS, SUPPLIER_IDS, FORMATS_PRINTED } from '../supabase/functions/_shared/suppliers/index.js'
import { checkSupplier } from '../supabase/functions/_shared/suppliers/index.js'
import { reconcileOptions, variantsOf, checkVariant, readVariantKey, variantKey } from './variants.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(HERE, '..')
let n = 0, bad = 0
const QUEUE = []
const t = (name, fn) => { n++; QUEUE.push([name, fn]) }
const run = async () => {
  for (const [name, fn] of QUEUE) {
    try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) }
  }
}

/* no keys at all: every printer is then mocked, which is the shape a fresh clone runs in */
const { SUPPLIERS, supplier, providersFor } = printers(() => '')
const PRINTERS = SUPPLIERS, printer = supplier

/* the interface, as printers/index.js declares it at the top of the file */
const SHAPE = ['configured', 'mock', 'options', 'product', 'measure', 'quote', 'validate', 'order', 'status', 'statusOf', 'webhook', 'ensureWebhook']
const FIELDS = ['id', 'name', 'formats', 'levels']
/* the only status words the rest of the system knows */
const STATUSES = ['submitted', 'in_production', 'shipped', 'rejected', 'canceled', 'failed']
/* our shipping words (src/lib/shipping.js) */
const OUR_LEVELS = ['standard', 'priority', 'express']

t('every id resolves to the supplier it names, and the registry is the whole list', () => {
  for (const id of SUPPLIER_IDS) assert.equal(supplier(id).id, id, id)
  assert.deepEqual(Object.keys(SUPPLIERS).sort(), [...SUPPLIER_IDS].sort())
})

/*
 * THE PRINTERS ARE A SUBSET, and the others are what prove the seam. A post room makes nothing
 * and sends by hand; a download makes a file and sends nothing. Both answer the same interface
 * Lulu answers, and neither knows what a page is.
 */
t('the printers are the suppliers that make a printed format', () => {
  for (const id of PRINTER_IDS) assert.ok(supplier(id).makes.some((f) => FORMATS_PRINTED.includes(f)), id)
})

t('a supplier that makes nothing is never offered as a way to make something', () => {
  const post = supplier('post-room')
  assert.deepEqual(post.makes, [], 'a shelf is not a printing press')
  for (const f of FORMATS_PRINTED) assert.ok(!providersFor(f).some((p) => p.id === 'post-room'), f)
  assert.equal(post.sends, true, 'but it does send')
})

t('a download is done on arrival, costs nothing, and sends nothing', async () => {
  const dl = supplier('download')
  assert.equal(dl.sends, false)
  const q = await dl.quote({ product: {}, artefacts: {} })
  assert.equal(q.print, 0, 'a real zero, not an unknown')
  const job = await dl.order({ externalId: 'x' })
  assert.equal(job.status, 'shipped', 'there is no moment between paying and having it')
})

t('and a post room will not guess at a price it cannot know', async () => {
  const q = await supplier('post-room').quote({ product: {}, artefacts: {} })
  assert.equal(q, null, 'null is "ask the shop"; a zero would read as free')
})

t('a download with no file to give is the one thing it can refuse', async () => {
  const dl = supplier('download')
  assert.equal((await dl.validate({ artefacts: { files: {} } })).ok, false)
  assert.equal((await dl.validate({ artefacts: { files: { pdf: 'x' } } })).ok, true)
})

t('neither of them needs a key, so neither is ever a mock', () => {
  for (const id of ['post-room', 'download']) {
    assert.equal(supplier(id).configured(), true, id)
    assert.equal(supplier(id).mock(), false, `${id}: a mock stands in for a service that is not there, and this one is`)
  }
})
t('an id that is not a printer throws, naming it', () => {
  assert.throws(() => printer('kinkos'), /kinkos/)
})

for (const id of PRINTER_IDS) {
  const p = PRINTERS[id]
  t(`${id}: answers the whole interface`, () => {
    for (const k of SHAPE) assert.equal(typeof p[k], 'function', `${id}.${k} is not a function`)
    for (const k of FIELDS) assert.ok(p[k] != null, `${id}.${k} is missing`)
  })
  t(`${id}: makes at least one of our formats, and only ours`, () => {
    assert.ok(p.formats.length > 0, 'makes nothing')
    for (const f of p.formats) assert.ok(FORMATS_PRINTED.includes(f), `${id} claims format "${f}"`)
  })
  t(`${id}: speaks all three of our shipping words`, () => {
    for (const l of OUR_LEVELS) assert.ok(p.levels[l] != null, `${id} has no word for "${l}"`)
  })
  /* The mapping runs one way — the PRINTER'S word onto ours — so what is pinned is its RANGE: it
     answers one of our six or nothing at all. A word of its own we had not mapped must come back
     null rather than pass through, because a status we do not know would move a print order into a
     state no screen draws and no retry clears. */
  t(`${id}: statusOf answers one of our words, or nothing`, () => {
    for (const w of ['unknown-word-from-the-printer', '', null, undefined, 42, {}]) {
      const ours = p.statusOf(w)
      assert.ok(ours == null || STATUSES.includes(ours), `${id}.statusOf(${JSON.stringify(w)}) = ${JSON.stringify(ours)}`)
    }
    /* and it does map something: a printer whose whole map was empty would silently never move */
    const live = ['CREATED', 'created', 'IN_PRODUCTION', 'in_production', 'PRODUCTION_DELAYED', 'SHIPPED', 'shipped', 'dispatched', 'REJECTED', 'rejected', 'CANCELED', 'cancelled', 'UNPAID', 'PAYMENT_IN_PROGRESS', 'printed', 'Dispatched', 'Complete', 'ERROR']
    assert.ok(live.some((w) => STATUSES.includes(p.statusOf(w))), `${id} maps none of the words a printer actually sends`)
  })
  t(`${id}: with no keys it is mocked, not configured`, () => {
    assert.equal(p.configured(), false)
    assert.equal(p.mock(), true)
  })
  /* `product()` is declared pure, and the pipeline leans on that: the edition hash is computed
     from what it returns, so a product that varied per call would make the same book a new
     edition every time it was set */
  t(`${id}: product() is pure and names a minimum page count`, () => {
    const f = p.formats[0]
    const args = { format: f, trim: '6x9', paper: 'cream', cloth: 'black', foil: 'gold', options: {} }
    const a = p.product(args), b = p.product(args)
    assert.deepEqual(a, b, 'two calls differ')
    assert.ok(Number(a.minPages) > 0, 'no minPages')
  })
  t(`${id}: options() answers a list of fields for every format it makes`, () => {
    for (const f of p.formats) {
      const opts = p.options(f)
      assert.ok(Array.isArray(opts), `${id}.options(${f}) is not a list`)
      for (const o of opts) {
        assert.ok(o.key, `${id}.options(${f}): a field with no key`)
        assert.ok(o.label, `${id}.options(${f}).${o.key}: no label`)
        /* the admin draws a control per field, so a kind it cannot draw is a field nobody can set */
        assert.ok(['text', 'number', 'select', 'boolean', 'toggle', 'color', 'file'].includes(o.type), `${id}.options(${f}).${o.key}: type "${o.type}"`)
        if (o.type === 'select') assert.ok(Array.isArray(o.choices) && o.choices.length, `${id}.options(${f}).${o.key}: a select with no choices`)
      }
    }
  })
  /* A CALLBACK IS AN OPEN DOOR. `webhook(body)` is handed a body from the internet, and the whole
     of print-webhook's safety is that it never trusts it — it reads an id out and asks the printer
     itself. So a body that is nonsense must yield nothing rather than something. */
  t(`${id}: a forged or empty callback body yields no job id`, () => {
    for (const body of [null, undefined, '', {}, { hello: 'world' }, 'not json at all', []]) {
      let out
      try { out = p.webhook(body) } catch { out = null }
      assert.ok(out == null || out === '' || typeof out === 'string', `${id}.webhook returned ${JSON.stringify(out)}`)
      if (typeof out === 'string') assert.equal(out, '', `${id}.webhook invented the job id ${JSON.stringify(out)} from ${JSON.stringify(body)}`)
    }
  })
}

t('providersFor gives, for every printed format, the printers that make it', () => {
  for (const f of FORMATS_PRINTED) {
    const got = providersFor(f).map((p) => p.id)
    const expect = PRINTER_IDS.filter((id) => PRINTERS[id].formats.includes(f))
    assert.deepEqual(got.sort(), expect.sort(), f)
  }
})
t('with mocks refused and no keys, nothing is offered', () => {
  for (const f of FORMATS_PRINTED) assert.deepEqual(providersFor(f, { mocked: false }), [], f)
})

/*
 * ─── A SITE ADDS ITS OWN, and nothing in the kit knows it exists ───
 *
 * The claim a plug-in seam makes is that somebody outside it can plug in. That is worth exactly
 * what the thing proving it is worth, so the demo registers a hand bindery down the road: no
 * API, no webhook, no account, and no business being a module in the kit.
 */
t('a site\'s own supplier joins the registry beside the kit\'s', async () => {
  const { bindery } = await import('../../../sites/demo/build/suppliers.mjs')
  const r = printers(() => '', [bindery])
  assert.ok(r.ids.includes('bindery'), 'the site\'s own is there')
  for (const id of SUPPLIER_IDS) assert.ok(r.ids.includes(id), `and the kit's ${id} still is`)
  assert.equal(r.supplier('bindery').name, 'The bindery on Mill Lane')
})

t('and is offered for what it makes, exactly as the kit\'s are', async () => {
  const { bindery } = await import('../../../sites/demo/build/suppliers.mjs')
  const r = printers(() => '', [bindery])
  assert.ok(r.providersFor('hardcover').some((p) => p.id === 'bindery'))
  assert.ok(!r.providersFor('pdf').some((p) => p.id === 'bindery'), 'and not for what it does not')
})

/* A SUPPLIER THAT DOES NOT KEEP THE SHAPE IS REFUSED AT REGISTRATION, by name, rather than
   halfway through somebody buying something. */
t('a malformed supplier is refused by name, with what is wrong with it', () => {
  assert.throws(() => printers(() => '', [{ id: 'broken' }]), /broken/)
  assert.throws(() => printers(() => '', [{ id: 'broken' }]), /does not keep the shape/)
  assert.throws(() => printers(() => '', [{ id: 'Bad Id', name: 'x', makes: [], needs: [] }]), /id:/)
})

t('and two suppliers cannot share a name', async () => {
  const { bindery } = await import('../../../sites/demo/build/suppliers.mjs')
  assert.throws(() => printers(() => '', [bindery, bindery]), /two suppliers are called/)
})

/*
 * `needs` IS HOW A DEPLOY REFUSES BEFORE IT STARTS. A supplier that cannot reach anybody is a
 * sale that fails at the till, and the till is too late to find out.
 */
/*
 * `keys` IS THE ENVIRONMENT; `needs` IS THE ARTEFACTS. Two meanings under one name is how
 * `unmet()` would have begun reporting LULU_CLIENT_KEY as a missing artefact — and reported it
 * as a reason a book could not be printed.
 */
t('every supplier says which environment keys it cannot work without', () => {
  for (const id of SUPPLIER_IDS) assert.ok(Array.isArray(supplier(id).keys), `${id}: keys`)
  assert.deepEqual(supplier('post-room').keys, [], 'a shelf needs no account')
  assert.deepEqual(supplier('download').keys, [])
  assert.ok(supplier('lulu').keys.includes('LULU_CLIENT_KEY'))
})

/*
 * THE PAIRING IS MATCHED FOR REAL, not only in fixtures. `unmet()` had no production caller at
 * all, so the half of the seam that refuses a supplier a kind cannot feed was never tested against
 * a real supplier — and the moment `needs` meant two things, it would have reported
 * LULU_CLIENT_KEY as a missing artefact and nobody would have found out.
 */
t('a real supplier is matched against a real kind, and a mismatch names the artefact', async () => {
  const { unmet } = await import('./kinds/index.js')
  /* what a book's kind produces — the names print.ts actually hands a supplier today */
  const book = { key: 'book', produces: ['pages', 'files'] }
  /* every supplier that makes a book can be fed by one — and Printify, which makes garments,
     CANNOT, which is the check doing its job rather than a gap: a book's kind produces a page
     count and two files, and a garment printer wants artwork. The pairing is matched when the
     shop is configured, so a shop that pointed a book at Printify is told then and not at the
     till. */
  for (const id of SUPPLIER_IDS) {
    const want = id === 'printify' ? ['artwork'] : []
    assert.deepEqual(unmet(book, supplier(id)), want, `${id} against a book`)
  }
  /* and a kind with no files cannot feed a printer, which is said by artefact name */
  const pagesOnly = { key: 'x', produces: ['pages'] }
  assert.deepEqual(unmet(pagesOnly, supplier('lulu')), ['files'])
  assert.deepEqual(unmet(pagesOnly, supplier('post-room')), [], 'a shelf takes anything')
})

t('and `keys` is never confused with `needs`, which is a different question', () => {
  for (const id of SUPPLIER_IDS) {
    const x = supplier(id)
    for (const k of x.keys) assert.ok(/^[A-Z][A-Z0-9_]*$/.test(k), `${id}: ${k} does not read as an environment key`)
    for (const n of x.needs || []) assert.ok(!/^[A-Z][A-Z0-9_]*$/.test(n), `${id}: ${n} reads as an environment key, but needs: is artefacts`)
  }
})

t('a site supplier with its key missing is a mock, and with it present is not', async () => {
  const { bindery } = await import('../../../sites/demo/build/suppliers.mjs')
  const without = printers(() => '', [bindery]).supplier('bindery')
  assert.equal(without.configured(), false); assert.equal(without.mock(), true)
  const withKey = printers((k) => (k === 'BINDERY_EMAIL' ? 'hello@example.com' : ''), [bindery]).supplier('bindery')
  assert.equal(withKey.configured(), true); assert.equal(withKey.mock(), false)
})

/*
 * ─── THE VOCABULARY: no method signature says "book" ───
 *
 * This is the half that makes the seam real. A supplier takes a variant’s CHOSEN values and its
 * ARTEFACTS; what is inside the artefacts is the kind’s business and the supplier’s, and nothing
 * between them needs to know. The interface used to take `pages` and `files` by name, so a
 * supplier that makes a shirt could not implement it and the word "plug-in" was doing no work.
 *
 * Checked against the source rather than by reading it, because reading is how it was verified
 * last time.
 */
const BOOK_WORDS = ['pages', 'interior', 'trim', 'paper', 'cloth', 'foil', 'spine', 'jacket', 'cover', 'binding', 'book', 'isbn']
for (const id of SUPPLIER_IDS) {
  t(`${id}: no method takes a word belonging to one kind of thing`, () => {
    const src = fs.readFileSync(path.join(KIT, 'supabase/functions/_shared/suppliers', id + '.js'), 'utf8')
    /* every method signature in the returned object, which is the interface anybody calls —
       written either way, as shorthand or as an arrow property, since both are used */
    const sigs = [...src.matchAll(/^    (?:async )?([a-zA-Z]+)\(([^)]*)\)/gm), ...src.matchAll(/^    ([a-zA-Z]+): (?:async )?\(([^)]*)\) =>/gm)]
      .filter((m) => SHAPE.includes(m[1]) || m[1] === 'register')
      .map((m) => ({ method: m[1], args: m[2] }))
    assert.ok(sigs.length >= 6, `${id}: expected to find its methods, found ${sigs.length}`)
    const guilty = sigs.filter((x) => BOOK_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(x.args)))
      .map((x) => `${x.method}(${x.args.trim().slice(0, 60)})`)
    assert.deepEqual(guilty, [], `these take a book's words, so nothing else can be made through them:\n      ` + guilty.join('\n      '))
  })
}

t('and the interface the header declares is the general one', () => {
  const idx = fs.readFileSync(path.join(KIT, 'supabase/functions/_shared/suppliers/index.js'), 'utf8')
  const header = idx.slice(0, idx.indexOf('*/'))
  /* the METHOD lines, not the prose: the header explains what the interface used to take, and
     that explanation is worth keeping — it is why the seam is shaped as it is */
  const methods = header.split('\n').filter((l) => /^ \*   [a-zA-Z]+\(/.test(l))
  assert.ok(methods.length >= 6, `expected the header to declare the methods, found ${methods.length}`)
  const guilty = methods.filter((l) => BOOK_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(l.split('\u2192')[0]))).map((l) => l.trim().slice(2, 70))
  assert.deepEqual(guilty, [], `the declared interface still takes a book's words:\n      ` + guilty.join('\n      '))
  assert.ok(/artefacts/.test(header), 'and it says what a supplier is given instead')
})

/* ─── the seam: nothing outside the printers' own directory knows a printer's name ─── */

const SKIP = /node_modules|\.print|dist|\.velite|supabase\/functions\/_shared\/suppliers|build\/suppliers\.test\.mjs/
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.(mjs|js|ts|vue)$/.test(e.name)) out.push(p)
  }
  return out
}
/* the places a printer's name is legitimately said: the block a book declares, the admin's own
   select, the docs, and the environment variables each printer's keys live in */
/* Where a printer's name is legitimately said. The webhook pair is the one real exception and is
   listed rather than waved through: Lulu is the ONLY printer with a callback registered once at a
   url — Mixam is given its callback per order, and Bookvault sends none — so a deploy step that
   registers "the printer's webhook" is registering Lulu's and could not be written generically
   without inventing a subscription the other two do not have. A fourth printer that DID need one
   would have to be added here by hand, which is exactly why it is a named exception. The two webhook
   FUNCTIONS are the same exception seen from the other end: a callback that arrives with no
   `provider` is Lulu's, because Lulu is the only printer that posts to a registered url, and
   `lulu-webhook` is that url's original name kept as an alias. */
const ALLOWED = /suppliers\/|print\/suppliers\.mjs|print\/webhook\.mjs|steps\/lulu-webhook\.mjs|functions\/lulu-webhook\/|functions\/print-webhook\/|PrintAdmin\.vue|print-offers\.js|deploy-checks\.mjs|\.test\.mjs/
t('no module outside the printers names a printer id in code', () => {
  const said = []
  for (const f of walk(KIT)) {
    if (ALLOWED.test(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    /* a bare quoted id: `'lulu'` — a word in a comment or a url is not a choice being made */
    for (const id of PRINTER_IDS) if (new RegExp(`['"\`]${id}['"\`]`).test(src)) said.push(path.relative(KIT, f) + ' → ' + id)
  }
  assert.deepEqual(said, [], 'a printer chosen outside providersFor:\n    ' + said.join('\n    '))
})

/*
 * ─────────── A SUPPLIER'S CATALOGUE SUPPLIES AN OFFER'S OPTIONS ───────────
 *
 * The axes of a thing somebody else makes are not the shop's to invent: a blueprint says which
 * colours and sizes exist. So a supplier may publish them, they are written into the file as
 * ORDINARY option rows marked with the supplier's id, and the case that costs money is the
 * catalogue dropping a value — which must take the thing off sale without a cart line losing its
 * meaning, and must come back on by itself when the catalogue restores it.
 */
const CAT = (axes) => ({ ...supplier('post-room'), id: 'pod', name: 'A print-on-demand shop', catalogue: async () => axes })

t('a catalogue supplies the axes as ordinary option rows, marked with whose they are', async () => {
  const pod = CAT([{ name: 'Colour', values: ['Black', 'White'] }, { name: 'Size', values: ['S', 'M', 'L'] }])
  const { options, added, gone } = reconcileOptions([], await pod.catalogue(), { from: pod.id })
  assert.deepEqual(options.map((o) => o.slug), ['colour', 'size'])
  assert.deepEqual(options.map((o) => o.from), ['pod', 'pod'])
  assert.deepEqual(options[0].values.map((v) => v.value), ['black', 'white'])
  assert.equal(added.length, 5, 'every value is new the first time')
  assert.deepEqual(gone, [])
  /* and they are variants like any other, with the offer's own sku and lookup key */
  const vs = variantsOf({ sku: 'tee', key: 'aa11bb22' }, options)
  assert.equal(vs.length, 6)
  assert.equal(vs[0].variant, 'black.s')
  assert.equal(vs[0].sku, 'tee-black-s')
  assert.ok(vs.every((v) => v.sold))
})

t('a shop\u2019s own axis is never touched by a refresh, and keeps its place after the supplier\u2019s', async () => {
  const pod = CAT([{ name: 'Colour', values: ['Black'] }])
  const mine = [{ name: 'Gift wrap', values: ['Yes', 'No'] }]
  const first = reconcileOptions(mine, await pod.catalogue(), { from: pod.id })
  assert.deepEqual(first.options.map((o) => o.slug), ['colour', 'gift-wrap'])
  assert.equal(first.options[1].from, undefined, 'the shop\u2019s own carries no provenance')
  /* a second run changes nothing about it, and does not report it */
  const again = reconcileOptions(first.options, await pod.catalogue(), { from: pod.id })
  assert.deepEqual(again.options, first.options)
  assert.equal(again.changed, false)
  assert.deepEqual(again.gone, [])
  assert.deepEqual(again.added, [])
})

t('A CATALOGUE THAT DROPS A VALUE takes it off sale and keeps its key readable', async () => {
  const offer = { sku: 'tee', key: 'aa11bb22' }
  const full = CAT([{ name: 'Colour', values: ['Black', 'White'] }, { name: 'Size', values: ['S', 'M'] }])
  const one = reconcileOptions([], await full.catalogue(), { from: 'pod' })
  assert.equal(variantsOf(offer, one.options).filter((v) => v.sold).length, 4)

  /* White is discontinued */
  const less = CAT([{ name: 'Colour', values: ['Black'] }, { name: 'Size', values: ['S', 'M'] }])
  const two = reconcileOptions(one.options, await less.catalogue(), { from: 'pod' })
  assert.deepEqual(two.gone.map((g) => g.value), ['white'], 'the shop is told WHICH value went')
  assert.equal(two.gone[0].option, 'Colour')

  /* the row is still there, so a key still reads — and it is marked */
  const colour = two.options.find((o) => o.slug === 'colour')
  assert.deepEqual(colour.values.map((v) => v.value), ['black', 'white'], 'nothing is deleted')
  assert.equal(colour.values.find((v) => v.value === 'white').gone, true)
  assert.deepEqual(readVariantKey('white.m', two.options).map((c) => c.label), ['White', 'M'],
    'an order in flight still reads as the words somebody chose')

  /* and it is off sale, by every route that decides */
  const vs = variantsOf(offer, two.options)
  assert.equal(vs.length, 4, 'the combination still exists')
  assert.equal(vs.filter((v) => v.sold).length, 2, 'half of them are gone')
  assert.ok(vs.find((v) => v.variant === 'white.m').gone, 'and say why')
  assert.equal(checkVariant(two.options, 'white.m'), null, 'the till refuses it')
  assert.ok(checkVariant(two.options, 'black.m'), 'and still sells the rest')
})

t('a value the catalogue brings back sells again, with nothing to clean up', async () => {
  const full = [{ name: 'Colour', values: ['Black', 'White'] }]
  const one = reconcileOptions([], full, { from: 'pod' })
  const two = reconcileOptions(one.options, [{ name: 'Colour', values: ['Black'] }], { from: 'pod' })
  const three = reconcileOptions(two.options, full, { from: 'pod' })
  assert.deepEqual(three.added.map((a) => a.value), ['white'], 'and the shop is told it is back')
  assert.deepEqual(three.gone, [])
  assert.ok(three.options[0].values.every((v) => !v.gone))
  assert.ok(variantsOf({ sku: 't', key: 'k' }, three.options).every((v) => v.sold))
  /* a value still absent on a later run is not reported a second time: it went once */
  const four = reconcileOptions(two.options, [{ name: 'Colour', values: ['Black'] }], { from: 'pod' })
  assert.deepEqual(four.gone, [])
  assert.equal(four.changed, false)
})

t('a shop\u2019s own unsold list is never written by a refresh', async () => {
  const one = reconcileOptions([], [{ name: 'Colour', values: ['Black', 'White'] }], { from: 'pod' })
  const two = reconcileOptions(one.options, [{ name: 'Colour', values: ['Black'] }], { from: 'pod' })
  assert.equal('unsold' in two, false, 'the mark is the mechanism; the list stays the shop\u2019s')
  /* so a shop that said it does not sell black still does not, and white is gone as well */
  const vs = variantsOf({ sku: 't', key: 'k' }, two.options, { sold: { not: ['black'] } })
  assert.deepEqual(vs.filter((v) => v.sold).map((v) => v.variant), [])
})

t('AN AXIS THE CATALOGUE DROPS WHOLE is kept, because removing it renumbers every key', async () => {
  const one = reconcileOptions([], [{ name: 'Colour', values: ['Black'] }, { name: 'Size', values: ['S', 'M'] }], { from: 'pod' })
  assert.equal(variantKey(readVariantKey('black.m', one.options)), 'black.m')
  const two = reconcileOptions(one.options, [{ name: 'Size', values: ['S', 'M'] }], { from: 'pod' })
  assert.deepEqual(two.options.map((o) => o.slug), ['size', 'colour'], 'the dropped axis is kept, last')
  assert.ok(two.options.find((o) => o.slug === 'colour').values.every((v) => v.gone))
  assert.deepEqual(two.gone.map((g) => g.value), ['black'])
  /* nothing sells, which is right: there is no Colour to pick and every key holds one */
  assert.deepEqual(variantsOf({ sku: 't', key: 'k' }, two.options).filter((v) => v.sold), [])
})

t('a catalogue has to say whose it is, and most suppliers publish none', async () => {
  assert.throws(() => reconcileOptions([], [{ name: 'A', values: ['b'] }], {}), /whose it is/)
  /* a printer makes what it is sent and has no opinion about colours; a print-on-demand shop's
     blueprint has colours and sizes of its own, and they are ITS fact rather than the shop's */
  const PUBLISHES = ['printify']
  for (const id of SUPPLIER_IDS) {
    const has = typeof supplier(id).catalogue === 'function'
    assert.equal(has, PUBLISHES.includes(id), id + (has ? ' publishes a catalogue and should not' : ' publishes none and should'))
  }
  /* and one that does is still a supplier: the method is optional, not a hole in the shape */
  assert.deepEqual(checkSupplier(CAT([])), [])
  assert.deepEqual(checkSupplier({ ...supplier('post-room'), catalogue: 'soon' }).filter((b) => b.startsWith('catalogue')).length, 1)
})

/*
 * ─────────── THE SEAM IS REAL IN PRODUCTION, not only in the interface ───────────
 *
 * The registry COULD walk a site's suppliers, the demo's bindery WAS registered in its config,
 * and until build/suppliers.mjs nothing in a build or an admin ever passed one — so every surface
 * quietly ran on the kit's five and the only thing proving the seam was the test above, importing
 * the module by hand. That is how a plug-in seam rots: true of the interface, false of the
 * product. These ask the door, exactly as the models and the build steps do.
 */
t('the door gives a site the kit\u2019s suppliers plus its own, from its config alone', async () => {
  const { suppliersFor } = await import('./suppliers.mjs')
  const kit = (await suppliersFor({ root: path.resolve(KIT, '../..') })).map((x) => x.id)
  assert.deepEqual(kit, SUPPLIER_IDS, 'a site that registers none gets the kit\u2019s, in order')
  const demo = (await suppliersFor({ root: path.resolve(KIT, '../../sites/demo') })).map((x) => x.id)
  assert.deepEqual(demo, [...SUPPLIER_IDS, 'bindery', 'ridgeway'], 'and a site\u2019s own come after, not instead')
})

t('and the kinds the same way, through the same door', async () => {
  const { kindsFor } = await import('./suppliers.mjs')
  assert.ok(Array.isArray(await kindsFor({ root: path.resolve(KIT, '../..') })))
})

t('a root with no config at all still answers the kit\u2019s, rather than throwing', async () => {
  const { suppliersFor } = await import('./suppliers.mjs')
  const none = (await suppliersFor({ root: path.resolve(KIT, 'build') })).map((x) => x.id)
  assert.deepEqual(none, SUPPLIER_IDS)
})

t('THE REFRESH ACTION reads a supplier\u2019s catalogue, and says so when there is none', async () => {
  const { COLLECTIONS } = await import('./models/core/collections.mjs')
  const refresh = COLLECTIONS.products.actions && COLLECTIONS.products.actions.refresh
  assert.equal(typeof refresh, 'function', 'the products model has a refresh')
  /* a store of one product, in memory: the action reads and writes through it like any other */
  const files = { 'content/store/products/tee.md': '---\nsku: tee\ntitle: A tee\nsupplier: lulu\n---\n' }
  const store = {
    read: async (f) => files[f] ?? null,
    write: async (f, text) => { files[f] = text },
    list: async () => Object.keys(files).map((f) => f.split('/').pop().replace(/[.]md$/, '')),
    exists: async (f) => f in files,
  }
  const ctx = { store, root: path.resolve(KIT, '../..') }
  /* Lulu publishes no catalogue, and that is a real answer rather than silence */
  await assert.rejects(() => refresh({ name: 'tee' }, ctx), /publishes no catalogue/)
  /* a product naming nobody is refused before anything is read */
  files['content/store/products/plain.md'] = '---\nsku: plain\ntitle: Plain\n---\n'
  await assert.rejects(() => refresh({ name: 'plain' }, ctx), /names no supplier/)
  await assert.rejects(() => refresh({ name: 'nope' }, ctx), /no such product/)
  files['content/store/products/odd.md'] = '---\nsku: odd\nsupplier: nobody\n---\n'
  await assert.rejects(() => refresh({ name: 'odd' }, ctx), /no supplier called nobody/)
})

/*
 * ─────────── THE WHOLE LOOP, END TO END, through a site's own supplier ───────────
 *
 * A product names Ridgeway; the refresh reads its catalogue and writes the axes into the file as
 * ordinary rows; the variants fall out of them; Ridgeway drops a colour and the thing is off sale
 * with its key still readable. Nothing here is a fixture of the mechanism — the only fixture is
 * what Ridgeway's own catalogue() answers, which is a fetch on a real account.
 */
t('a product takes its axes from a site supplier\u2019s catalogue, and loses one when it is dropped', async () => {
  const { COLLECTIONS } = await import('./models/core/collections.mjs')
  const refresh = COLLECTIONS.products.actions.refresh
  const DEMO = path.resolve(KIT, '../../sites/demo')
  const files = { 'content/store/products/tee.md': '---\nsku: ridgeway-tee\nkey: aa11bb22\ntitle: A plain tee\nsupplier: ridgeway\nprice: 28\n---\nSoft, and it lasts.\n' }
  const store = { read: async (f) => files[f] ?? null, write: async (f, t2) => { files[f] = t2 }, exists: async (f) => f in files, list: async () => ['tee'] }
  const ctx = { store, root: DEMO }

  /* counted from Ridgeway's own catalogue, so the fixture may change what it runs this month
     without this test having to be edited to agree with it */
  const { suppliersFor } = await import('./suppliers.mjs')
  const rg = (await suppliersFor({ root: DEMO })).find((x) => x.id === 'ridgeway')
  const axes = await rg.catalogue()
  const every = axes.reduce((n2, o) => n2 + o.values.length, 0)

  const one = await refresh({ name: 'tee' }, ctx)
  assert.equal(one.changed, true)
  assert.deepEqual(one.options.map((o) => o.name), axes.map((o) => o.name))
  assert.ok(one.options.every((o) => o.from === 'ridgeway'))
  assert.equal(one.added.length, every, 'every value of every axis is new the first time')
  assert.deepEqual(one.gone, [])
  /* AND IT IS IN THE FILE, as rows a person could have typed */
  const written = files['content/store/products/tee.md']
  assert.match(written, /Colour/)
  assert.match(written, /from: ridgeway/)
  assert.match(written, /Soft, and it lasts\./, 'the body is untouched')
  assert.match(written, /sku: ridgeway-tee/, 'and so is everything else in the front matter')

  /* twelve shirts, every one on sale, each with its own sku */
  const vs = variantsOf({ sku: 'ridgeway-tee', key: 'aa11bb22' }, one.options)
  assert.equal(vs.length, axes.reduce((n2, o) => n2 * o.values.length, 1))
  assert.ok(vs.every((v) => v.sold))
  assert.equal(vs.find((v) => v.variant === 'oat.l').sku, 'ridgeway-tee-oat-l')

  /* a second refresh changes nothing and writes nothing */
  const before = files['content/store/products/tee.md']
  const two = await refresh({ name: 'tee' }, ctx)
  assert.equal(two.changed, false)
  assert.equal(files['content/store/products/tee.md'], before, 'an unchanged catalogue does not touch the file')

  /* now Ridgeway stops making Slate blue. The reconciler is pure, so this is the same call the
     action makes — what is being checked is that what came out of the file goes back in. */
  const doomed = axes[0].values[axes[0].values.length - 1]
  const narrowed = axes.map((o, i) => (i ? o : { ...o, values: o.values.slice(0, -1) }))
  const { data } = (await import('gray-matter')).default(files['content/store/products/tee.md'])
  const three = reconcileOptions(data.options, narrowed, { from: 'ridgeway' })
  assert.deepEqual(three.gone.map((g) => g.label), [doomed.label], 'the shop is told, in the words it reads')
  const after = variantsOf({ sku: 'ridgeway-tee', key: 'aa11bb22' }, three.options)
  assert.equal(after.length, vs.length, 'nothing is deleted')
  const sizes = axes[1].values.length
  assert.equal(after.filter((v) => v.sold).length, vs.length - sizes, 'every shirt in that colour is off sale')
  const dead = doomed.value + '.' + axes[1].values[2].value
  assert.equal(checkVariant(three.options, dead), null, 'and the till refuses one')
  assert.deepEqual(readVariantKey(dead, three.options).map((c) => c.label), [doomed.label, axes[1].values[2].label],
    'while an order already placed still says what somebody bought')
})

await run()
console.log(bad ? `suppliers: ${n - bad} passed, ${bad} failed` : `suppliers: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
