/*
 * Experiments — A/B tests over pages and ads.
 *
 * An experiment is its own record (content/experiments/<name>.md): a kind
 * (`page` or `ad`), its variants — each a key, the page or ad it shows, and a
 * weight — a goal, and its verdict. Pages and ads know nothing about testing;
 * the experiment points at them.
 *
 * A visitor is dealt a variant at random by weight and keeps it (in the Loro
 * store, so it follows a signed-in reader across devices). Showing the variant
 * is recorded once per session as an `experiment` event naming the goal; the
 * goal is met by a later pageview of the goal path in the same session, or —
 * for an ad experiment with no goal path — a later click on the ad.
 *
 * Status: `winner` declared, or `ends` passed (default: two weeks after the
 * first exposure) → ended, everyone gets the winner (declared, else the best
 * conversion rate, read from the public experiment_state() RPC and cached for
 * an hour); `active: false` → paused, everyone gets the first variant; else
 * running.
 */
import { experiments as ALL } from '#content'
import { get as storeGet, set as storeSet } from './store.js'
import { supabase, configured } from './supabase.js'
import { capture } from './analytics.js'

const ASSIGN_KEY = 'dl.exp.v1'        /* { [experiment]: { variant, at } } */
const STATE_KEY = 'dl.expstate.v1'    /* { [experiment]: { at, started_at, variants: [...] } } */
export const TWO_WEEKS = 14 * 86400000
const STATE_TTL = 60 * 60 * 1000

const read = (k) => { try { return JSON.parse(storeGet(k) || 'null') || {} } catch (e) { return {} } }
const write = (k, v) => { try { storeSet(k, JSON.stringify(v)) } catch (e) { /* full */ } }

export const experiments = () => ALL || []

/* the experiment (and the variant entry) that shows this page or ad, if any */
export function experimentFor(kind, itemId) {
  for (const exp of experiments()) {
    if (exp.kind !== kind) continue
    const variant = (exp.variants || []).find((v) => v.item === itemId)
    if (variant) return { exp, variant }
  }
  return null
}

function pickWeighted(variants) {
  const total = variants.reduce((n, v) => n + (v.weight > 0 ? v.weight : 0), 0)
  if (!total) return variants[0]
  let r = Math.random() * total
  for (const v of variants) { r -= v.weight > 0 ? v.weight : 0; if (r <= 0) return v }
  return variants[variants.length - 1]
}

/* ---- what the network knows: first exposure and counts per variant ---- */
const refreshing = {}
async function refresh(name) {
  if (!configured || refreshing[name]) return
  refreshing[name] = true
  try {
    const { data, error } = await supabase.rpc('experiment_state', { name })
    if (!error && data) { const all = read(STATE_KEY); all[name] = { ...data, at: Date.now() }; write(STATE_KEY, all) }
  } catch (e) { /* offline */ } finally { refreshing[name] = false }
}
function stateOf(exp) {
  const state = read(STATE_KEY)[exp.id] || null
  if (!state || Date.now() - (state.at || 0) > STATE_TTL) refresh(exp.id)
  return state
}

/* when the experiment ends: its own date, or two weeks after it began */
export function endsAt(exp, state) {
  if (exp.ends) { const n = Date.parse(exp.ends); if (!isNaN(n)) return n }
  if (state && state.started_at) return Date.parse(state.started_at) + TWO_WEEKS
  return null
}
/* the winning variant: declared, else the best conversion rate so far */
export function winnerOf(exp, state) {
  const vs = exp.variants || []
  if (exp.winner) return vs.find((v) => v.key === exp.winner) || null
  const rows = (state && state.variants) || []
  let best = null, bestRate = -1
  for (const v of vs) {
    const r = rows.find((x) => x.variant === v.key)
    const rate = r && r.exposures ? r.conversions / r.exposures : 0
    if (rate > bestRate) { best = v; bestRate = rate }
  }
  return best
}
export function statusOf(exp, state) {
  if (exp.winner) return 'ended'
  const ends = endsAt(exp, state)
  if (ends && Date.now() > ends) return 'ended'
  if (exp.active === false) return 'paused'
  return 'running'
}

/* which variant this visitor gets, and why */
export function decide(exp) {
  const vs = exp.variants || []
  if (!vs.length) return null
  const state = stateOf(exp)
  const status = statusOf(exp, state)
  if (status === 'ended') { const w = winnerOf(exp, state); if (w) return { variant: w, decided: 'winner' } }
  if (status === 'paused') return { variant: vs[0], decided: 'control' }
  const assigned = read(ASSIGN_KEY)
  let v = assigned[exp.id] && vs.find((x) => x.key === assigned[exp.id].variant)
  if (!v) {
    v = pickWeighted(vs)
    assigned[exp.id] = { variant: v.key, at: Date.now() }
    write(ASSIGN_KEY, assigned)
  }
  return { variant: v, decided: 'assigned' }
}

/* what an exposure will say: the experiment, the variant, what was shown and
   how the goal is met */
function tag(item, exp, d) {
  const adClick = exp.kind === 'ad' && !exp.goal
  return { ...item, experiment: exp.id, variant: d.variant.key, decided: d.decided,
    goal: adClick ? item.id : (exp.goal || '/app'), goalType: adClick ? 'cta_click' : 'pageview' }
}

/* the page to show for a route, out of the pages that share it */
export function choosePage(cands) {
  if (!cands.length) return null
  for (const exp of experiments()) {
    if (exp.kind !== 'page') continue
    const mine = (exp.variants || []).filter((v) => cands.some((p) => p.id === v.item))
    if (!mine.length) continue
    const d = decide({ ...exp, variants: mine })
    const page = d && cands.find((p) => p.id === d.variant.item)
    if (page) return tag(page, exp, d)
  }
  if (cands.length > 1 && import.meta.env.DEV) console.warn('[pages] several pages share a route with no experiment between them:', cands.map((p) => p.id).join(', '))
  return cands[0]
}

/* ads, with each experiment collapsed to the one variant this visitor gets */
export function filterAds(ads) {
  const out = []
  const chosen = {}   /* experiment id → the ad id it shows */
  for (const ad of ads || []) {
    const hit = experimentFor('ad', ad.id)
    if (!hit) { out.push(ad); continue }
    const { exp } = hit
    if (!(exp.id in chosen)) { const d = decide(exp); chosen[exp.id] = d ? { id: d.variant.item, d } : null }
    const c = chosen[exp.id]
    if (c && c.id === ad.id) out.push(tag(ad, exp, c.d))
  }
  return out
}

/* the exposure: once per session per experiment. A page or ad that carries no
   experiment tag, or is shown as the settled winner, records nothing. */
export function expose(item) {
  if (!item || !item.experiment || item.decided !== 'assigned') return
  const k = 'dl.exp.seen.' + item.experiment
  try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, item.variant) } catch (e) { /* private */ }
  capture('experiment', { experiment: item.experiment, variant: item.variant, item: item.id, goal: item.goal, goal_type: item.goalType })
}
