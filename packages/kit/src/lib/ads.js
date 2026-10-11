/*
 * CTA targeting — which ad, for this reader, right now.
 *
 * Ads are markdown (content/ads/*.md) carrying targeting rules: an
 * audience (user classes), canonical topic slugs, any/all matching, a minimum
 * number of matching pieces the reader must have opened, and a cooldown. A
 * ad earns a score from three signals, most specific first:
 *
 *   • the page they're on now (its canonical topics)             +5 per hit
 *   • what their results say — readerSignals() mapped to slugs:
 *       exact life-area × stage cell 4, same area other stages 3,
 *       personality type 2, a charged complex/wound 2
 *   • what they've been reading — a rolling tally of topic slugs  up to +3
 *
 * so "7 of the 10 pieces you opened were about power" outranks a single visit,
 * and a reader whose results name a wound outranks one who merely browsed it.
 * Ties break on the ad's priority. Frequency lives in the Loro store: a
 * full modal at most once an hour, and each ad honours its own cooldown
 * after being shown or dismissed.
 *
 * The reader-profile module drags the diagnostic engine with it, which App.vue
 * keeps out of the main bundle on purpose — so it is imported lazily, only when
 * an ad is actually being chosen.
 */
import { ads as ALL } from '#content'
import { userClass } from './auth.js'
import { get as storeGet, set as storeSet } from './store.js'
import { filterAds } from './experiments.js'
import { ROUTES, STORE_ON } from './router.js'

const HIST_KEY = 'dl.viewhist.v1'
const CTA_KEY = 'dl.cta.v1'
const MODAL_EVERY_MS = 60 * 60 * 1000
const STAGES = ['circumstance', 'relationship', 'realization']

const read = (k, d) => { try { const r = storeGet(k); return r ? JSON.parse(r) : d } catch (e) { return d } }
const save = (k, v) => storeSet(k, JSON.stringify(v))

/* ---- the rolling tally of topic slugs the reader has opened ---- */
export function recordView(topics) {
  if (!Array.isArray(topics) || !topics.length) return
  const h = read(HIST_KEY, { n: 0, t: {} })
  h.n += 1
  for (const s of topics) h.t[s] = (h.t[s] || 0) + 1
  save(HIST_KEY, h)
}
export const viewTally = () => read(HIST_KEY, { n: 0, t: {} })

/* ---- what the results say, as weighted slugs ---- */
async function signalSlugs() {
  const w = {}
  try {
    const { readerSignals, topicByKey } = await import('#site/recommendations')   /* the site's scorer, or the kit's defaults (nothing) */
    const sig = readerSignals()
    if (!sig || !sig.has) return w
    const put = (t, score) => { if (t && t.slug) w[t.slug] = Math.max(w[t.slug] || 0, score) }
    if (sig.area && sig.stage) put(topicByKey('cell', sig.area + ':' + sig.stage), 4)
    if (sig.area) for (const st of STAGES) put(topicByKey('cell', sig.area + ':' + st), 3)
    if (sig.type) put(topicByKey('type', String(sig.type)), 2)
    for (const c of sig.complexes || []) put(topicByKey('complex', c), 2)
  } catch (e) { /* no results, or the engine failed to load — browse signals still apply */ }
  return w
}

/* ---- frequency ---- */
const freq = () => read(CTA_KEY, { lastModalAt: 0, shown: {}, dismissed: {} })
export const canShowModalNow = () => Date.now() - (freq().lastModalAt || 0) > MODAL_EVERY_MS
export function markShown(id, { modal } = {}) {
  const f = freq(); f.shown[id] = Date.now(); if (modal) f.lastModalAt = Date.now(); save(CTA_KEY, f)
}
export function markDismissed(id) { const f = freq(); f.dismissed[id] = Date.now(); save(CTA_KEY, f) }
function onCooldown(b, f) {
  const hours = typeof b.cooldownHours === 'number' ? b.cooldownHours : 24
  const last = Math.max(f.shown[b.id] || 0, f.dismissed[b.id] || 0)
  return !!last && Date.now() - last < hours * 3600 * 1000
}

/* ---- the pick ---- */
export async function pickAd({ placement, pageTopics = [] } = {}) {
  const cls = userClass.value
  const f = freq()
  const sig = await signalSlugs()
  const hist = viewTally()
  const page = new Set(pageTopics || [])
  const scored = []
  /* an ad under test appears here only as the variant this visitor was dealt */
  for (const b of filterAds(ALL)) {
    /* an ad that sends people to the store is nothing without one */
    if (!STORE_ON && b.href && (b.href === ROUTES.store || b.href.startsWith(ROUTES.store + '/') || b.href.startsWith(ROUTES.store + '?'))) continue
    /* 'both' is modal and inline; the footer is its own placement */
    if (placement && b.placement !== placement && !(b.placement === 'both' && placement !== 'footer')) continue
    if (b.audience && b.audience.length && !b.audience.includes(cls)) continue
    if (onCooldown(b, f)) continue
    const topics = b.topics || []
    let score = 0, hits = 0, matchedViews = 0
    for (const s of topics) {
      let t = 0
      if (page.has(s)) t += 5
      if (sig[s]) t += sig[s]
      if (hist.t[s]) { t += Math.min(3, hist.t[s]); matchedViews += hist.t[s] }
      if (t) { hits += 1; score += t }
    }
    if (topics.length && (b.match === 'all' ? hits < topics.length : hits === 0)) continue
    if ((b.minTopicViews || 0) > matchedViews) continue
    scored.push({ b, score: score * 10 + (b.priority || 0) })
  }
  scored.sort((a, z) => z.score - a.score)
  return scored.length ? scored[0].b : null
}
