/*
 * WHO PRINTS A FORMAT, AND WHAT IT WOULD COST.
 *
 * The block names a printer per format, or says `auto` and the cheapest real quote wins. That
 * choice has to be made the same way wherever a book is set — on a machine by `npm run print`, in
 * an Edge Function by print-render — because it decides which printer's dimensions the cover is
 * drawn to and which printer's minimum the book is padded to. Two ways of choosing is a cover
 * that does not fit the press it is sent to.
 *
 * The printers themselves are passed in rather than imported: the build binds them to
 * `process.env` and a function to `Deno.env`, and this module has no opinion about either.
 */

/* what a block prints: the formats it sells, and for a linen every cloth × foil the buyer may pick */
export function printedOf(spec, printed) {
  const formats = printed.filter((f) => (spec.formats || {})[f])
  const combos = []
  const hc = (spec.formats || {}).hardcover
  if (hc) for (const c of [].concat(hc.cloth || [])) for (const g of [].concat(hc.foil || [])) combos.push([c, g])
  return { formats, combos }
}

/*
 * THE PRINTERS A FORMAT MAY GO TO: the one the block NAMES, or every one with keys where it says
 * `auto` (every one there is, mocked, when none has keys). Taking all of them regardless is how
 * the function once padded a book to 40 pages where the build bound it at 32 — a press it will
 * never see had the higher minimum.
 */
export function candidatesOf(spec, format, { providersFor, printer }) {
  const named = (spec.printers || {})[format]
  if (named && named !== 'auto') { try { return [printer(named)] } catch (e) { return [] } }
  const all = providersFor(format), real = all.filter((p) => p.configured())
  return real.length ? real : all
}

/*
 * WHO PRINTS IT. The block's word, or the cheapest of the printers that will quote one copy —
 * every candidate asked, so the others' quotes are kept beside the choice and a later run can say
 * why this one won. A printer that throws is recorded as having refused rather than dropped: the
 * reason is what somebody reads when a book will not go to the press they expected.
 */
export async function chooseProvider(spec, format, pages, trim, paper, { providersFor, printer, costUsd }) {
  const named = (spec.printers || {})[format]
  if (named && named !== 'auto') return { provider: named, quotes: {} }
  const pool = candidatesOf(spec, format, { providersFor, printer })
  const quotes = {}
  let best = null
  for (const p of pool) {
    try {
      const product = p.product({ chosen: { format, trim, paper, cloth: spec.cloth, foil: spec.foil }, options: (spec.providers || {})[p.id] || {} })
      const q = await p.quote({ product, artefacts: { pages: Math.max(pages, product.minPages || 24) }, country: 'US' })
      quotes[p.id] = { cost: q.print, currency: q.currency }
      const usd = costUsd({ cost: q.print, currency: q.currency })
      if (best == null || usd < best.usd) best = { id: p.id, usd }
    } catch (e) { quotes[p.id] = { error: String(e.message || e).slice(0, 120) } }
  }
  if (!best) throw new Error(`no printer could quote a ${format}`)
  return { provider: best.id, quotes }
}

/*
 * CAN A PRINTER FETCH THIS? A printer is given a signed url and fetches the file ITSELF, from its
 * own machines on the internet. So a url that this process can open says nothing: what matters is
 * whether a stranger could.
 *
 * Two kinds fail, and the second is the one that bit. A local stack's `127.0.0.1` is obviously
 * private. But an Edge Function signs urls against its own `SUPABASE_URL`, which locally is the
 * stack's INNER host — `http://kong:8000` — and that is not loopback, so a check written against
 * loopback alone waves it through and Lulu answers "received a None status code" after a timeout.
 *
 * The rule is therefore positive rather than a blacklist: a public host has a dot in it and is not
 * a private address. A bare name (`kong`, `supabase_storage`) is a name only a container knows.
 */
const PRIVATE = /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|172\.(1[6-9]|2\d|3[01])\.)/
export function reachableToPrinter(url) {
  let u
  try { u = new URL(String(url)) } catch (e) { return false }
  if (!/^https?:$/.test(u.protocol)) return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h === '::1' || h === '[::1]' || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (PRIVATE.test(h)) return false
  return h.includes('.')
}
