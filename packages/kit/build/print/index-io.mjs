/*
 * `print.json` — WHAT HAS BEEN SET, AND WHERE IT IS.
 *
 * The store reads this for a book's pages, its prices, its cover art and its dimensions; the
 * catalog carries it to the functions as `editions`; a print order looks up which file its
 * printer gets. It is written in two places — by `npm run print` on a machine and by
 * print-render in an Edge Function — so the merge is here, once, rather than in each of them.
 *
 * It is DERIVED, not a declaration: nobody edits it, and whatever sets an edition owns it. It
 * lives under `content/` all the same, which means in cloud mode it is a row like every other
 * file and is read and written through the store — never `fs`.
 */

/* one book's editions, merged into the index — pure, so both callers agree by construction */
export function mergeIndex(idx, manifests) {
  const out = { ...(idx || {}) }
  for (const m of manifests) {
    if (!m || m.local) continue
    const b = out[m.slug] && out[m.slug].editions ? { ...out[m.slug] } : { editions: {}, ...(out[m.slug] || {}) }
    b.editions = { ...(b.editions || {}) }
    Object.assign(b, { trim: m.trim, paper: m.paper, title: m.title, author: m.author, made: m.made })
    /* the dimensions by cover key (points) and the covers' art, for the store's book; the printers by format */
    const dims = Object.fromEntries(Object.entries(m.dims || {}).map(([k, d]) => [k, { width: d.width, height: d.height, spine: d.spine, bleed: d.bleed, flap: d.flap || 0 }]))
    const printers = Object.fromEntries(Object.entries(m.printers || {}).map(([f, x]) => [f, { provider: x.provider, product: x.product, products: x.products, key: x.key, covers: x.covers, foils: x.foils || {}, cost: x.cost ?? null, currency: x.currency || null, shipping: x.shipping ?? null, days: x.days ?? null, from: x.from || null, quotes: x.quotes || {}, options: x.options || {}, ref: x.ref || null, validated: !!x.validated, note: x.note || '' }]))
    /* the art and the page pictures are the LISTING's, and a run that made none must not wipe
       what an earlier run made: a cloud render draws no page pictures, and the gallery it would
       otherwise empty is the one a machine filled */
    const had = (out[m.slug] && out[m.slug].editions && out[m.slug].editions[m.contents]) || {}
    b.editions[m.contents] = {
      edition: m.edition, pages: m.pages, printers, covers: m.covers, dims,
      art: Object.keys(m.art || {}).length ? m.art : (had.edition === m.edition ? had.art || {} : {}),
      shots: Object.keys(m.shots || {}).length ? m.shots : (had.edition === m.edition ? had.shots || {} : {}),
      epub: !!m.epub, foilStamp: m.foilStamp, validated: !!m.validated, made: m.made,
    }
    /* an edition of contents the block no longer sells is dropped (its files stay in the bucket) */
    if (Array.isArray(m.sells)) for (const c of Object.keys(b.editions)) if (!m.sells.includes(c)) delete b.editions[c]
    out[m.slug] = b
  }
  return out
}

export const INDEX_PATH = 'content/store/print.json'

/* through the STORE: a checkout on a machine, a row of public.content in cloud mode */
export async function readIndex(store) {
  try { return JSON.parse((await store.read(INDEX_PATH)) || '{}') } catch (e) { return {} }
}
export async function writeIndex(store, idx, meta = {}) {
  const text = JSON.stringify(idx, null, 2) + '\n'
  await store.write(INDEX_PATH, text, meta)
  return idx
}

/* ---- the registry: the titles a printer keeps for us, which must never be made twice ----
   A stateful printer (Bookvault) keeps a title per book, contents and format, made once for a
   fee. Every title is written in TWO places the moment it is made — the bucket's
   `<slug>/registry.json` (the truth on a box whose checkout may lag) and print.json's `titles`
   — and read from both before any is made, with the printer asked by our SKU besides. */

export const registryOf = (idx, slug) => ({ titles: (idx && idx[slug] && idx[slug].titles) || {} })

/* the bucket's record over the index's, printer by printer: neither alone is the whole truth */
export function mergeRegistry(reg, fromBucket) {
  const titles = { ...(reg.titles || {}) }
  for (const [p, m] of Object.entries((fromBucket && fromBucket.titles) || {})) titles[p] = { ...(titles[p] || {}), ...m }
  return { titles }
}

/* a book's titles into the index, leaving its editions alone */
export const withTitles = (idx, slug, titles) => ({ ...(idx || {}), [slug]: { ...((idx || {})[slug] || { editions: {} }), titles } })

/* what a title is filed under: one per contents and format, per printer */
export const titleKey = (contents, format) => `${contents}-${format}`
