/*
 * OPTIONS IN, VARIANTS OUT. Pure, no io, no environment — the build calls it, the admin calls it,
 * the checkout function calls it through the catalog, and all three must agree to the character.
 *
 * An offer declares named options with ordered values; the variants are the combinations. That is
 * the whole idea, and the care is all in three places where getting it wrong is expensive later.
 *
 * 1. THE ORDER OF THE OPTIONS IS THE ORDER OF THE KEY. "parts.black.gold" is contents, then
 *    cloth, then foil, because that is the order the options are declared in. A set would be
 *    tidier and would renumber every existing cart line the first time somebody reordered a
 *    form, so the key is positional and the declared order is load-bearing. Reordering options
 *    is therefore a breaking change to a shop's variant keys, which is said here because it is
 *    not obvious and nothing else will say it.
 *
 * 2. A VALUE IS A SLUG, AND THE SLUG IS WHAT IS STORED. The label is what a person reads and may
 *    be edited freely; the slug is identity and may not. A value with no slug takes one from its
 *    label the first time, and keeps it.
 *
 * 3. THE KEY IS THE ONE PRINT ALREADY USES. `variantOf(contents, cloth, foil)` in
 *    src/lib/print-offers.js joins with dots and drops the empties; so does this, so a printed
 *    book's cart lines, purchases and print orders mean the same thing before and after
 *    (build/variants.test.mjs enumerates every combination of every book in print and compares).
 *
 * The sku and the lookup key are derived once and never recomputed from a label, for the same
 * reason the offers' `key` is eight hex given once: a sku that follows a rename is a sale that
 * cannot be found afterwards.
 */

/* a value's slug: lowercase, words joined by a dash, nothing else. The one rule, so that the same
   label always gives the same slug on every machine. */
export const slug = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/*
 * An offer's options, normalised. Takes what a file says in any of the shapes a person writes it
 * and answers one shape: [{ name, slug, values: [{ value, label }] }].
 *
 *   options: [{ name: 'Size', values: ['S', 'M'] }]
 *   options: [{ name: 'Size', values: [{ value: 's', label: 'Small' }] }]
 *   options: { Size: ['S', 'M'] }
 */
export function normaliseOptions(raw) {
  const list = Array.isArray(raw) ? raw
    : raw && typeof raw === 'object' ? Object.entries(raw).map(([name, values]) => ({ name, values }))
      : []
  return list.map((o) => {
    const name = String((o && o.name) || '').trim()
    const values = (Array.isArray(o && o.values) ? o.values : []).map((v) => {
      if (v && typeof v === 'object') return { value: slug(v.value ?? v.label), label: String(v.label ?? v.value ?? ''), ...(v.gone ? { gone: true } : {}) }
      return { value: slug(v), label: String(v ?? '') }
    }).filter((v) => v.value)
    /* PROVENANCE SURVIVES THE NORMALISER. `from` is whose catalogue an axis came from and `gone`
       is a value that catalogue no longer offers; dropping either here would mean a refresh could
       not tell its own rows from a shop's, and would quietly take over hand-written ones. */
    return { name, slug: slug(name), values, ...(o && o.from ? { from: String(o.from) } : {}) }
  }).filter((o) => o.name && o.values.length)
}

/* every combination, in declared order, options outermost-first so the first option varies
   slowest — which is the order a person reads a table of them in */
export function combinations(options) {
  if (!options.length) return [[]]
  let out = [[]]
  for (const o of options) {
    const next = []
    for (const row of out) for (const v of o.values) next.push([...row, { option: o.name, slug: o.slug, value: v.value, label: v.label, ...(v.gone ? { gone: true } : {}) }])
    out = next
  }
  return out
}

/* THE KEY: the values' slugs joined by dots, in the options' declared order — exactly what
   print's `variantOf(contents, cloth, foil)` produces for a book. An offer with no options has
   the empty key, which is what a line carrying no variant already says. */
export const variantKey = (chosen) => (chosen || []).map((c) => c.value).filter(Boolean).join('.')

/* and back: the values in order, each NAMED — the option it belongs to and the label the value
   wears, not only its slug. Without the options it can do none of that, which is why the reader
   takes them: the same asymmetry print's parseVariant has, made explicit. The label matters
   because a purchase freezes what a person saw, and "leather" is not what anybody read. A value
   the options do not hold keeps its slug as its label rather than vanishing, so a key written
   before an option was reworded still reads as something. */
export function readVariantKey(key, options) {
  const parts = String(key || '').split('.').filter(Boolean)
  return normaliseOptions(options).map((o, i) => {
    const value = parts[i] || ''
    const v = o.values.find((x) => x.value === value)
    return { option: o.name, slug: o.slug, value, label: v ? v.label : value }
  })
}

/*
 * THE KEYS, REWRITTEN FOR A NEW ORDER OF OPTIONS.
 *
 * The key is positional — "leather.lined" is Cover then Ruling because that is the order they
 * are declared in — so moving an option changes what every key MEANS. Print has written keys
 * that way since before any of this and its cart lines, purchases and print orders all depend on
 * it, so the format stays; what has to not happen is a file left saying "leather.lined" when
 * "leather" is no longer the first value.
 *
 * That is not a cart problem, it is a FILE problem, and it happened: the admin asked before
 * reordering and then reordered without touching `variants` or `unsold`, leaving keys no
 * combination could produce. The build refuses such a file by name, so it was loud rather than
 * silent — but the editor should not be able to write one at all.
 *
 * History is safe either way: a purchase snapshots its option values WITH their names
 * (`lineSnapshot`), so a sale from last year reads correctly however the options are arranged
 * now. The key is for matching what is live, not for remembering what happened.
 */
export function remapKeys(keys, before, after) {
  const was = normaliseOptions(before)
  const now = normaliseOptions(after)
  const out = {}
  for (const key of keys || []) {
    const parts = String(key || '').split('.').filter(Boolean)
    /* read it against the order it was written in, by option name */
    const had = new Map()
    was.forEach((o, i) => { if (parts[i]) had.set(o.slug, parts[i]) })
    /* and write it in the order they are in now; an option that has gone takes its part with it */
    const next = now.map((o) => had.get(o.slug)).filter(Boolean)
    out[key] = next.length === now.length ? next.join('.') : null
  }
  return out
}

/*
 * THE WHOLE MATRIX for an offer. `sold` says which combinations are actually for sale — absent,
 * every one is; a file may name the few it does not sell rather than the many it does.
 *
 * A variant's sku is the offer's with its values after it, which is readable in Stripe's
 * dashboard and in a webhook's log without a lookup. Its lookup key is the offer's key and the
 * variant key, because the offer's key is the thing that never changes.
 */
/*
 * AN OFFER'S OPTIONS, from wherever they come. Three sources, in one place so that nothing
 * downstream has to know which it was:
 *
 *   options:        what the file declares
 *   sizes: [S, M]   the short way to write one Size option, kept because a shop that only needs
 *                   sizes should not have to learn the longer form — it IS the longer form
 *   a kind          what a registration supplies (build/kinds), already normalised when it
 *                   arrives, so it is simply put first or last as the file says
 *
 * Declared options win where both are written, and `sizes` is appended rather than replacing
 * them, because a shirt with a Colour option and a sizes list means both.
 */
export function optionsOf(offer, fromKind = []) {
  const declared = normaliseOptions((offer && offer.options) || [])
  const sized = (offer && Array.isArray(offer.sizes) && offer.sizes.length && !declared.some((o) => o.slug === 'size'))
    ? normaliseOptions([{ name: 'Size', values: offer.sizes }])
    : []
  const kind = normaliseOptions(fromKind)
  /* a kind's options come first: they are what the thing IS (a book's contents), where a shop's
     own are usually a further choice about it */
  const all = [...kind, ...declared, ...sized]
  const seen = new Set()
  return all.filter((o) => (seen.has(o.slug) ? false : (seen.add(o.slug), true)))
}

export function variantsOf(offer, options, { sold } = {}) {
  const opts = normaliseOptions(options)
  const not = new Set((sold && sold.not) || [])
  return combinations(opts).map((chosen) => {
    const key = variantKey(chosen)
    return {
      variant: key,
      chosen,
      sku: key ? `${offer.sku}-${key.split('.').join('-')}` : offer.sku,
      lookup: key ? `${offer.key}.${key}` : offer.key,
      label: chosen.map((c) => c.label || c.value).join(' · '),
      /* NOT SOLD FOR EITHER REASON, and the two are different facts: `gone` is the supplier's
         catalogue having dropped a value, `unsold` is the shop having said so. Both end a sale;
         only one of them is the shop's decision, which is why the mark is not folded into the list. */
      sold: !not.has(key) && !variantGone(chosen),
      ...(variantGone(chosen) ? { gone: true } : {}),
    }
  })
}

/* IS THIS COMBINATION ONE THE OFFER SELLS? The general form of print's `printVariant`: it answers
   the chosen values where it is, and null where it is not, so a caller can refuse by name. An
   empty key against an offer with options means "the first of each", which is how a cart line
   that named no variant has always behaved. */
export function checkVariant(options, key, { sold } = {}) {
  const opts = normaliseOptions(options)
  if (!opts.length) return String(key || '') ? null : {}
  const parts = String(key || '').split('.').filter(Boolean)
  const chosen = {}
  for (let i = 0; i < opts.length; i++) {
    const want = parts[i] || opts[i].values[0].value
    if (!opts[i].values.some((v) => v.value === want)) return null
    chosen[opts[i].name] = want
  }
  if (parts.length > opts.length) return null
  const not = new Set((sold && sold.not) || [])
  if (not.has(opts.map((o) => chosen[o.name]).join('.'))) return null
  /* AND A VALUE THE SUPPLIER NO LONGER MAKES. The till has to refuse it, or a shop whose
     catalogue dropped a colour goes on taking orders for it until somebody notices. */
  for (const o of opts) if ((o.values.find((v) => v.value === chosen[o.name]) || {}).gone) return null
  return chosen
}

/*
 * A SUPPLIER'S CATALOGUE, RECONCILED WITH WHAT THE FILE ALREADY SAYS.
 *
 * A shop that sells a thing somebody else makes does not invent its axes: a print-on-demand
 * blueprint says which colours and sizes exist, and typing them by hand is how a shop comes to
 * sell a colour the supplier stopped making. So a supplier may supply the axes, and they are
 * written into the file AS ORDINARY OPTION ROWS marked `from: <supplier id>` — not a separate
 * mechanism, not a live fetch at the till. Everything downstream — the variants, the keys, the
 * admin's grid, the catalog, the checkout's own check — reads them exactly as it reads a row
 * somebody typed.
 *
 * Then the catalogue changes, and the case that costs money is A VALUE DROPPED. Deleting its row
 * would be wrong twice over: a cart line or an unfulfilled order names that variant and would
 * stop resolving, and the shop is never told it has stopped selling something. So a dropped value
 * STAYS, marked `gone` — which is the whole mechanism, because `variantsOf` reads the mark and
 * every combination holding one is not sold. Nothing is written to `unsold`:
 *
 *   - the shop's own "we do not sell that combination" is never overwritten, because the
 *     reconciler never touches that list;
 *   - a value the catalogue brings back loses its mark and its combinations are on sale again,
 *     with nothing to remember and nothing to clean up.
 *
 * Storing the dead keys instead would need the file to remember which entries were the
 * reconciler's and which were the shop's, and a list of keys has nowhere to say.
 *
 * An AXIS the catalogue no longer has at all is kept whole with every value marked, for the same
 * reason its values are: removing an axis renumbers every key the offer has, and a positional key
 * must never be renumbered behind a shop's back (see THE KEYS, REWRITTEN above — that is a
 * deliberate act, with the file's keys carried along).
 *
 * What the shop wrote stays the shop's: an axis with no `from`, or one from another supplier, is
 * passed through untouched. On a supplied axis the catalogue is authoritative — a value a shop
 * added there by hand is indistinguishable from one the catalogue dropped, so this does not try
 * to tell them apart and the admin adds its own values to an axis of its own.
 *
 * Pure: `fetched` is what a supplier's `catalogue()` answered. Nothing here fetches.
 */
export function reconcileOptions(existing, fetched, { from } = {}) {
  if (!from) throw new Error('reconcileOptions: a catalogue has to say whose it is')
  const have = normaliseOptions(existing || [])
  const theirs = normaliseOptions(fetched || []).map((o) => ({ ...o, from }))
  const mine = have.filter((o) => o.from !== from)
  const was = new Map(have.filter((o) => o.from === from).map((o) => [o.slug, o]))

  const gone = []
  const added = []
  const options = theirs.map((o) => {
    const before = was.get(o.slug)
    was.delete(o.slug)
    if (!before) {
      for (const v of o.values) added.push({ option: o.name, slug: o.slug, value: v.value, label: v.label })
      return o
    }
    const now = new Map(o.values.map((v) => [v.value, v]))
    const had = new Map(before.values.map((v) => [v.value, v]))
    for (const v of o.values) {
      /* new, or back from the dead — either way it is on sale now and says so by having no mark */
      if (!had.has(v.value) || had.get(v.value).gone) added.push({ option: o.name, slug: o.slug, value: v.value, label: v.label })
    }
    /* their values in the catalogue's order, then whatever it dropped, kept and marked. A value
       already marked gone and still absent is not reported again: it was reported when it went. */
    const dropped = before.values.filter((v) => !now.has(v.value)).map((v) => ({ ...v, gone: true }))
    for (const v of dropped) if (!had.get(v.value).gone) gone.push({ option: o.name, slug: o.slug, value: v.value, label: v.label })
    return { ...o, values: [...o.values, ...dropped] }
  })
  for (const o of was.values()) {
    for (const v of o.values) if (!v.gone) gone.push({ option: o.name, slug: o.slug, value: v.value, label: v.label })
    options.push({ ...o, values: o.values.map((v) => ({ ...v, gone: true })) })
  }
  /* the supplier's axes first, then the shop's — the order `optionsOf` already puts a kind's in,
     and the order a key is read in, so a refresh must not reorder what it does not own */
  return { options: [...options, ...mine], gone, added, changed: gone.length + added.length > 0 }
}

/* IS EVERY VALUE OF THIS COMBINATION STILL OFFERED? The one question the `gone` mark answers,
   kept here so the three places that ask it cannot disagree. */
export function variantGone(chosen) { return (chosen || []).some((c) => c.gone) }
