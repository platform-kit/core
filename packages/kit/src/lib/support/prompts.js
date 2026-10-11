/*
 * Chat prompts: a funnel's chat steps, shown by the browser. The build writes the published
 * funnels' prompts to .velite/support-prompts.json (build/funnels.mjs: the line, its triggers
 * — when.js's — and the funnel's audience rules), and this module watches the moment: once a
 * second it asks whether any prompt's triggers hold for where the reader is and how long they
 * have been here, and shows the first that does, once — a prompt shown is remembered
 * (dl.support.shown, in the store, so a signed-in reader's account carries it) and the server
 * keeps a thread per prompt per contact besides. Nothing is sent: a prompt is a popup, and it
 * becomes a thread only when the reader answers it (api.start with the prompt's id).
 *
 * The audience: a funnel with no rules is for everyone; one with rules is for signed-in
 * readers who match them now (email_audience_me, asked once per prompt per session), and
 * never for a guest, about whom nothing is known. Never on the admin, the preview, the share
 * cards, the prerender, or for the staff.
 */
import { ref, watch } from 'vue'
import { route, INTERRUPT_ROUTES } from '../router.js'
import { session, onIdentity } from '../auth.js'
import { supabase, configured } from '../supabase.js'
import { get as storeGet, set as storeSet } from '../store.js'
import { IN_PREVIEW, capture } from '../analytics.js'
import { items as cartItems } from '../cart.js'
import { holds } from './when.js'
import { mayInterrupt, newPageView, claimCorner, releaseCorner } from '../interrupt.js'
import { staff, panelOpen, thread } from './api.js'

const SHOWN_KEY = 'dl.support.shown'
const SITE_KEY = 'dl.support.site'      /* sessionStorage: when this session began */
const SEEN_KEY = 'dl.support.seen'      /* the store: this browser has been here before */

export const PROMPTS = Object.values(import.meta.glob('#content/support-prompts.json', { eager: true, import: 'default' }))[0] || []

export const teaser = ref(null)         /* the prompt on show, or null */
/* the panel's resting prompt (`when: default`) — the first published one whose audience holds for
   this reader; asked for when the panel opens, since a signed-in reader's audience is the server's */
export const fallback = ref(null)
export async function resolveDefault() {
  for (const p of PROMPTS.filter((x) => x.default)) { if (await audienceOk(p) === true) { fallback.value = p; return p } }
  fallback.value = null
  return null
}
/*
 * AND IT IS FORGOTTEN WHEN SOMEBODY ARRIVES. Which default holds is an audience question, and an
 * audience is about a person: a reader who signs in may match a prompt a guest could not (and the
 * other way). Holding the guest's answer would show them the wrong desk until they reloaded.
 */
onIdentity(() => { fallback.value = null })
/* the default's nudge: its teaser line above the launcher until the reader opens the panel or puts
   it away — once per session, a moment after they arrive, never over a pop-up */
export const nudge = ref(null)
const NUDGE_KEY = 'dl.support.nudge'
const NUDGE_AFTER_MS = 4000
const nudged = () => { try { return !!sessionStorage.getItem(NUDGE_KEY) } catch (e) { return false } }
export function quietNudge() { nudge.value = null; try { sessionStorage.setItem(NUDGE_KEY, '1') } catch (e) { /* private mode */ } }
async function offerNudge() {
  if (nudged() || nudge.value || teaser.value || panelOpen.value || staff.value || quiet(route.value)) return
  const path = route.value
  const p = fallback.value || await resolveDefault()
  if (!p || !p.teaser || path !== route.value || quiet(route.value) || nudged() || teaser.value || panelOpen.value || staff.value) return
  if (!claimCorner('chat')) return
  nudge.value = p
  track.shown(p, 'nudge')
}
/* the prompts as data: shown (how: default | teaser | nudge), a choice picked, a thread begun */
export const track = {
  shown: (p, how) => capture('support_prompt', { prompt: p.id, funnel: p.funnel, how, text: p.text }),
  chose: (p, c) => capture('support_choice', { prompt: p.id, funnel: p.funnel, choice: c.key, text: c.text }),
  started: (p, c) => capture('support_start', { prompt: p ? p.id : null, funnel: p ? p.funnel : null, choice: c ? c.key : null }),
}

const shown = () => { try { return JSON.parse(storeGet(SHOWN_KEY) || '[]') } catch (e) { return [] } }
const markShown = (id) => { const s = shown(); if (!s.includes(id)) storeSet(SHOWN_KEY, JSON.stringify(s.concat([id]))) }

let siteStart = 0, pageStart = 0, returning = false
function begin() {
  const now = Date.now()
  try {
    const t = Number(sessionStorage.getItem(SITE_KEY) || 0)
    siteStart = t || now
    if (!t) sessionStorage.setItem(SITE_KEY, String(now))
  } catch (e) { siteStart = now }
  returning = !!storeGet(SEEN_KEY)
  if (!returning) storeSet(SEEN_KEY, '1')
  pageStart = now
}

/* the audience, asked of the server once per prompt per session for a signed-in reader */
const asked = new Map()
async function audienceOk(p) {
  if (!p.rules || !Object.keys(p.rules).length) return true
  if (!session.value || !supabase || !configured) return false
  const k = p.id + ':' + session.value.user.id
  if (asked.has(k)) return asked.get(k)
  asked.set(k, null)   /* in flight */
  try {
    const { data } = await supabase.rpc('email_audience_me', { rules: p.rules })
    asked.set(k, data === true)
  } catch (e) { asked.set(k, false) }
  return asked.get(k)
}

/* where nothing may appear is one rule, asked by the chat and by the ad alike (lib/interrupt.js) */
const quiet = (path) => IN_PREVIEW || !mayInterrupt(path, INTERRUPT_ROUTES)

let ticker = null
async function tick() {
  if (teaser.value || panelOpen.value || staff.value || quiet(route.value)) return
  const now = Date.now()
  const ctx = { onSite: (now - siteStart) / 1000, pageTime: (now - pageStart) / 1000, path: route.value, signedIn: !!session.value, returning, cart: cartItems.value.length > 0 }
  const had = shown()
  for (const p of PROMPTS) {
    if (had.includes(p.id) || !holds(p.when, ctx)) continue
    const ok = await audienceOk(p)
    if (route.value !== ctx.path || quiet(route.value)) return
    if (ok !== true || teaser.value) continue
    /* the corner belongs to whoever takes it first in a page view: if an ad is already there, this
       waits for another page rather than stacking on it */
    if (!claimCorner('chat')) return
    teaser.value = p
    nudge.value = null
    markShown(p.id)
    track.shown(p, 'teaser')
    return
  }
}

export function startPrompts() {
  if (typeof window === 'undefined' || ticker || !PROMPTS.length) return
  begin()
  watch(route, (p) => { pageStart = Date.now(); newPageView(p) }, { immediate: true })
  ticker = setInterval(() => { if (document.visibilityState === 'visible') tick() }, 1000)
  setTimeout(offerNudge, NUDGE_AFTER_MS)
}
export function dismiss() { teaser.value = null; releaseCorner('chat') }
/* the reader answers: the panel opens on a thread that begins with the prompt's line */
export function reply() { const p = teaser.value; teaser.value = null; return p }
/* a thread open on the prompt already (the server said so): nothing to show again */
watch(() => thread.conversation && thread.conversation.prompt_id, (id) => { if (id) markShown(id) })
