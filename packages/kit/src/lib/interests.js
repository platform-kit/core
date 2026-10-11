/*
 * WHAT THE SITE HAS WORKED OUT THIS READER IS INTERESTED IN — the kit's own half of Recommended
 * For You, on any site, with nothing registered.
 *
 * The ranking used to need a site: forYou embeds a SENTENCE about the reader, and only a site with an instrument
 * could write one (from its diagnostics). A site with no such registration therefore had no vector,
 * no ranking and an empty lane — not because it had nothing to go on, but because nobody had said
 * what to do with what it had. It had plenty: what people read, and what they bought.
 *
 * So the kit composes its own sentence, out of the reader's own tags, most-weighted first. The
 * tags come from `my_interests()` — a JOIN of their reads and purchases against those pieces'
 * tags as those tags are NOW, never a trait stored at read time (see 13-search.sql for why
 * that distinction is the whole design). Nothing here computes a weight: the server does, so one
 * set of numbers governs, and a page cannot disagree with the database about what somebody likes.
 *
 * With no backend there is nothing to ask and nothing to be signed in to: `interests()` answers
 * empty, `has` is false, and the hub draws no toggle. That is the static shape, and it is the
 * absence of a capability rather than a failure of one.
 */
import { supabase, configured } from './supabase.js'
import { isSignedIn } from './auth.js'
import { tagsOf, profileText } from './rank.js'

/* the reader's tags, kept for the visit: the hub reads them on mount and again when the view
   changes, and the join is not free. Cleared when the identity changes (below). */
let held = null
let asking = null

export const EMPTY = { has: false, weights: {}, tags: [], text: '', read: new Set() }

/* `kind:ref` for anything already behind them, so a ranking made out of somebody's reading does not
   hand them back the five things they just read. See my_reading in 13-search.sql. */
export const seenKey = (kind, ref) => String(kind) + ':' + String(ref)


export async function interests() {
  if (!configured || !isSignedIn.value) return EMPTY
  if (held) return held
  if (asking) return asking
  asking = (async () => {
    try {
      const [got, was] = await Promise.all([supabase.rpc('my_interests'), supabase.rpc('my_reading')])
      if (got.error) throw got.error
      const weights = {}
      for (const r of got.data || []) weights[r.tag] = Number(r.weight) || 0
      const tags = tagsOf(weights)
      const read = new Set((was.data || []).map((r) => seenKey(r.kind, r.ref)))
      held = { has: tags.length > 0, weights, tags, text: profileText(weights), read }
    } catch (e) {
      /* the lane is a courtesy: a reader whose interests cannot be read gets Everything, never an
         error. Nothing here is worth interrupting a page for. */
      held = EMPTY
    } finally { asking = null }
    return held
  })()
  return asking
}

/* somebody signed in or out: whatever is held belongs to whoever it was read for */
export function forgetInterests() { held = null }
