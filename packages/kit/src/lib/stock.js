/*
 * WHAT THE SHOP HAS, read once per product and shared.
 *
 * The rule itself is `_shared/stock.js` — pure, and the checkout function applies the same one, so
 * a page and a payment can never disagree about whether a thing was available. This is only the
 * fetching: the counts are a public read (anyone may see what is left; nobody may write it), and
 * they are state, so they are never in the bundle and never in a file.
 *
 * ALL THREE SHAPES, AND THE DEFAULT IS ALWAYS "SELL IT".
 *
 *   static   — no backend, so `configured` is false, nothing is fetched and nothing is tracked.
 *              A static shop sells everything, which is correct: it has nowhere to keep a count,
 *              so it cannot have run out of anything.
 *   git      — the rows, read live. The build knows nothing about stock and must not: a count
 *              baked into a page is wrong by the time anybody reads it.
 *   cloud    — identical. Stock was never an artefact, so nothing about it needs a publish.
 *
 * The failure direction matters more than the mechanism. A fetch that fails, a table that is not
 * there, a deployment with no database: every one of them leaves the counts unknown, and unknown
 * means buyable. The alternative is a shop that silently stops selling, which nobody notices until
 * the day's takings are zero.
 */
import { ref } from 'vue'
import { supabase, configured } from './supabase.js'
import { stockKey } from '../../supabase/functions/_shared/stock.js'

/* the rule itself, re-exported so a page imports one name — the same door print-offers.js and
   variants.js use; nothing is added here */
export { availableOf, buyable, whyNot, offerOut, stockKey } from '../../supabase/functions/_shared/stock.js'

/* one map for the page, keyed as the rule keys it */
export const counts = ref(null)
const asked = new Set()

/* the counts for one offer (and its shapes). Asked once per sku per page; a second call is free. */
export async function loadStock(skus) {
  const want = (Array.isArray(skus) ? skus : [skus]).filter(Boolean).filter((s) => !asked.has(s))
  if (!configured || !want.length) return counts.value
  for (const s of want) asked.add(s)
  try {
    const { data, error } = await supabase.from('inventory').select('sku, variant, stocked, reserved').in('sku', want)
    if (error) return counts.value          /* no table, no rights, no matter: unknown is buyable */
    const next = { ...(counts.value || {}) }
    for (const r of data || []) next[stockKey(r.sku, r.variant)] = { stocked: r.stocked, reserved: r.reserved }
    /* a sku the table has no row for is KNOWN to be untracked-or-unstocked rather than unasked;
       recording nothing would make every re-render ask again */
    counts.value = next
  } catch { /* unknown is buyable */ }
  return counts.value
}

/* a shop that has just sold the last one: the page asks again rather than holding a stale number */
export function forgetStock(sku) { if (sku) asked.delete(sku); else asked.clear() }
