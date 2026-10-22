/*
 * Booking: the ways to book a session (content/sessions/*.md) and which of them a
 * reader gets. An option names who it is for — `requires`: `anyone`, `guest` (no
 * membership), `authenticated` (signed in, no membership), or a membership tier's
 * slug, which that tier and every higher rank gets — optionally capped with `below`,
 * a tier slug: shown only to readers whose rank is under it — and how many
 * a week it allows, counted against the reader's own bookings mirrored from cal.com
 * (supabase/functions/cal-webhook → bookings).
 *
 * The booking itself happens in the app, through the Edge Functions that talk
 * to cal.com's API (session-slots, book-session, cancel-session; _shared/cal.ts)
 * — never on cal.com's own page — so the same rules are checked before a
 * booking exists, and a paid session is bought as it is booked (checkout with
 * the chosen time; the Stripe webhook books it when the payment lands, and a
 * credit is left when that could not be, so the reader picks again).
 */
import { computed } from 'vue'
import { sessions as SESSIONS, products as PRODUCTS } from '#content'
import { user, memberTiers, creditsFor } from './auth.js'
import { tierRank, memberships } from './storefront.js'
import { admits } from 'platformkit/supabase/functions/_shared/sessions/admits.js'
import { supabase } from './supabase.js'
import { offeringType } from 'platformkit/supabase/functions/_shared/sessions/offering.js'

/* a call to one of the booking functions; an answer with an error becomes one */
async function call(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  const fail = (msg, code, extra) => { const e = new Error(msg); e.code = code || ''; Object.assign(e, extra || {}); throw e }
  if (error) {
    let msg = error.message || 'request failed', code = '', extra = {}
    try { const j = await error.context.json(); if (j && j.error) { msg = j.error; code = j.code || ''; extra = j } } catch (e) { /* no body */ }
    fail(msg, code, extra)
  }
  if (data && data.error) fail(data.error, data.code, data)
  return data
}
/* the open times of a session between two days (YYYY-MM-DD), in a zone */
export const openTimes = (event, from, to, timeZone, minutes, count) => call('session-slots', { event, from, to, timeZone, minutes: minutes || undefined, count: count || undefined })
/* book it (or move one: reschedule = its uid) */
export const bookSession = (event, start, timeZone, notes, reschedule, phone, response, minutes, count, email) => call('book-session', { event, start, timeZone, notes: notes || '', reschedule: reschedule || undefined, phone: phone || undefined, response: response || undefined, minutes: minutes || undefined, count: count || undefined, email: email || undefined })
/* a host books for people: the invitees by email — no judge, no credit, nothing charged */
export const bookForOthers = (event, start, timeZone, notes, emails, host) => call('book-session', { event, start, timeZone, notes: notes || '', for: emails, host: host || undefined })
/* WHO ELSE IS COMING to a group session, by the name each person chose to show — for somebody who
   holds a seat of it, and only where the type says to show it. Never an address: a list of who is in
   the room should not also be a list of how to write to them. */
export async function companyOf(uid) {
  const { data, error } = await supabase.rpc('booking_company', { p_uid: String(uid || '') })
  return error || !Array.isArray(data) ? [] : data.map((r) => r.name).filter(Boolean)
}
/* THE HOST'S WORD on a booking that was waiting for it. Saying yes IS the booking being made —
   the invitation, the room and the week of chat all follow — so it goes through book-session rather
   than somewhere of its own. */
export const answerBooking = (uid, yes) => call('book-session', { action: yes ? 'accept' : 'decline', uid })
/* the host marks a no-show, after the time */
export const markNoShow = (uid) => call('cancel-session', { uid, action: 'no-show' })
/* `run` cancels the rest of the run too, where the booking belongs to one — asked, never assumed */
export const cancelSession = (uid, reason, run) => call('cancel-session', { uid, reason: reason || undefined, run: run === true ? true : undefined })

/* a landing page may still link to a cal.com page (the public, no-account path,
   LandingCoaching / LandingCreator); that link carries the booker when there is
   one, so cal.com's form is prefilled. Members never see one: they book here. */
export const isBookingUrl = (href) => /^https?:\/\/(app\.)?cal\.com\//i.test(String(href || ''))
export function withBooker(href) {
  if (!isBookingUrl(href)) return href
  const u = user.value
  if (!u || !u.email) return href
  try {
    const url = new URL(href)
    url.searchParams.set('email', u.email)
    const name = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || ''
    if (name) url.searchParams.set('name', name)
    return url.toString()
  } catch (e) { return href }
}

/* the event type a cal.com url names, by its slug — what a mirrored booking carries as `event` */
export const eventOf = (href) => { try { return new URL(href).pathname.split('/').filter(Boolean).pop() || '' } catch (e) { return '' } }
/* where a session happens, as one line — from a type's flat fields (where, link, place, address, phone) or a booking's
   `where` record ({ kind, url, name, address, number }) — worded by the booker's `where-*` lines; '' for nowhere in particular */
export function placeOf(w, words = {}) {
  const kind = w && (w.kind || w.where) || 'none'
  const url = w && (w.url || w.link) || '', name = w && (w.name || w.place) || '', address = w && w.address || '', number = w && (w.number || w.phone) || ''
  const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
  if (kind === 'video') return words['where-video'] || ''
  if (kind === 'link') return words['where-link'] || ''
  if (kind === 'place') return [words['where-place'] || '', [name, address].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  if (kind === 'phone') return number ? fill(words['where-phone-ours'] || '{n}', { n: number }) : (words['where-phone-theirs'] || words['where-phone'] || '')
  return ''
}
/* who schedules a type: the file says, else cal.com when it carries a cal.com url, else the site's own */
export const schedulerOf = (s) => (s.scheduler === 'native' || s.scheduler === 'cal' ? s.scheduler : s.url ? 'cal' : 'native')
/* what a booking of a type carries as `event`: cal.com's event slug, or the file's own slug for a type the site schedules */
/* a type that carries its own event keeps it — a provider's offering is addressed by its row's id,
   so that no name a person chooses can collide with a declared type's slug */
export const eventOfType = (s) => (s.event ? s.event : schedulerOf(s) === 'cal' ? eventOf(s.url) : s.slug)

/* the reader's highest tier rank; 0 with no membership */
export const memberRank = computed(() => Math.max(0, ...memberTiers.value.map(tierRank)))
/* what each tier ranks, for the shared rule: { slug: rank } */
const RANKS = computed(() => Object.fromEntries((memberships.value || []).filter((m) => m.tier).map((m) => [m.tier, m.rank || 0])))

/*
 * A PROVIDER'S OWN OFFERINGS, AS BOOKING OPTIONS. The site's types are files and come from #content;
 * an offering is a row, because a declaration names classes of people and never a person.
 *
 * It is ONE read (provider_offerings_live) rather than a table read, for three things a client cannot
 * settle for itself: whether the site allows offerings at all, whether each provider is on terms they
 * have agreed to, and whose each one is. That last is the interesting one — a profile is private
 * until its owner says otherwise, and rightly so, but an offering is PUBLISHED, and an hour with
 * somebody that will not say who is not something anybody can buy. So the read names the provider of
 * a live offering and nothing else about them.
 *
 * The shape is a booking type's, so sessionOptions has one kind of thing to sort and a surface has
 * one kind of thing to draw.
 */
export { OFFERING, isOffering as isOfferingEvent, offeringId } from 'platformkit/supabase/functions/_shared/sessions/offering.js'
import { managedFor } from 'platformkit/supabase/functions/_shared/sessions/managed.js'
export { managedEvent, parseManaged } from 'platformkit/supabase/functions/_shared/sessions/managed.js'
export async function loadOfferings() {
  const { data, error } = await supabase.rpc('provider_offerings_live')
  if (error || !Array.isArray(data)) return []
  return data.map(asOption)
}
/* the offerings on one person's page: the same shape, without their name on each — the page is
   theirs and says whose it is once, at the top */
export async function offeringsOf(username) {
  const { data, error } = await supabase.rpc('provider_offerings_of', { p_username: String(username || '') })
  if (error || !Array.isArray(data)) return []
  return data.map(asOption)
}
/*
 * THE MANAGED TYPES ON SOMEBODY'S PAGE. A managed booking type is one file and N members: the copy
 * is computed here from the file and the rows that say who is in the team, exactly as the functions
 * compute it when the booking comes in — one derivation, shared, so the page and the judge cannot
 * offer and refuse the same thing.
 */
export async function managedOf(username) {
  const managed = (SESSIONS || []).filter((s) => s.assign === 'managed' && s.team && s.published !== false)
  if (!managed.length || !username) return []
  /* a membership is somebody's, not the public's, so the browser never reads the rows: it asks which
     PUBLISHED teams this person gives for, which says no more than the copy itself does */
  const { data } = await supabase.rpc('teams_giving', { p_username: String(username) })
  const teams = new Set(Array.isArray(data) ? data : [])
  /* wearing the card's shape, as an offering does through asOption below — a surface should have
     one kind of thing to draw, not two that differ in what they call a length */
  return managedFor(managed, { username, email: '', name: '' }, teams)
    .map((s) => ({ ...s, order: 80, minutes: s.duration, price_cents: 0, priceText: s.price || '' }))
}
/* a row from either read, as a booking option: the SHARED shape (so the judge and this list can never
   disagree), the row's own fields for a surface to draw, and where it sits in the list — after the
   site's own types, which are what the business itself sells */
export const asOption = (o) => ({ ...o, ...offeringType(o), offering: o.id, order: 90, unit_amount: Number(o.price_cents) || 0, currency: o.currency || 'usd' })

const WEEK = 7 * 864e5, MONTH = 30 * 864e5
/* the options for this reader, in order, each with its standing: { ...session,
   event, link, blocked, next, span } — blocked when the week's (`weekly`) or the
   month's (`monthly`) allowance is used (next: when the earliest counted booking
   falls out of that window; span: which window said so).

   This is the APP's gate: a used-up option shows no calendar. The cal.com link
   itself is public and cal.com knows nothing of tiers, so a booking made straight
   on cal.com is not stopped here — it is mirrored by the webhook and counts. */
export function sessionOptions(bookings = [], offerings = []) {
  const rank = memberRank.value, signed = !!user.value
  const now = Date.now()
  /* ONE LIST, TWO KINDS OF RECORD. A reader choosing a time is not thinking about which of the two
     they are choosing from, so they are merged here rather than shown as two surfaces. An offering
     is for anybody, so it passes the gate below untouched. */
  return [...(SESSIONS || []), ...(offerings || [])]
    .filter((s) => s.published !== false)
    /* A HIDDEN TYPE IS OFF EVERY LIST and reachable by its own address alone — a link somebody is
       given. It is not unpublished: it books exactly as any other does, for anybody who has the
       link and passes its gate. A MANAGED type is hidden from this list too, because it is not the
       team's to book: it lives on each member's own page. */
    .filter((s) => !((s.page || {}).hidden === true) && s.assign !== 'managed')
    .filter((s) => {
      /* a tier that lists the type admits it, whatever the type's own rules say */
      if ((PRODUCTS || []).some((p) => p.kind === 'membership' && p.tier && memberTiers.value.includes(p.tier) && (p.sessions || []).some((r) => r.type === s.slug))) return true
      /* ONE RULE, shared with the judge the functions ask (_shared/sessions/admits.js): two sides
         of a gate that disagree are not a gate. */
      return admits(s, { tiers: memberTiers.value, rank, signed, ranks: RANKS.value })
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99))
    .map((s) => {
      const event = eventOfType(s)
      /* the tier's own counts when one of the reader's tiers lists the type (the highest such tier); a booking a host made for them is never counted */
      const listed = (PRODUCTS || []).filter((p) => p.kind === 'membership' && p.tier && memberTiers.value.includes(p.tier) && (p.sessions || []).some((r) => r.type === s.slug)).sort((a, b) => (b.rank || 0) - (a.rank || 0))[0]
      const al = listed ? (listed.sessions || []).find((r) => r.type === s.slug) : null
      const weekly = al ? al.weekly : s.weekly, monthly = al ? al.monthly : s.monthly
      const within = (span) => bookings
        .filter((b) => b.event === event && !b.made_by && b.status !== 'cancelled' && b.status !== 'rescheduled' && b.start_at && new Date(b.start_at).getTime() >= now - span)
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
      let blocked = false, next = null, span = ''
      for (const [n, ms, name] of [[weekly, WEEK, 'week'], [monthly, MONTH, 'month']]) {
        if (blocked || !(n > 0)) continue
        const counted = within(ms)
        if (counted.length >= n) { blocked = true; span = name; next = new Date(new Date(counted[0].start_at).getTime() + ms) }
      }
      /* a paid session: the credits held for it (bought, not yet booked) */
      const offer = s.sku ? PRODUCTS.find((p) => p.sku === s.sku) : null
      return { ...s, event, scheduler: schedulerOf(s), blocked, next, span, included: !!al, paid: !!s.sku && !al, credits: s.sku ? creditsFor(s.sku) : 0,
        /* the catalog's amount for one of the site's own types; an offering carries its own, because
           it is priced by its row */
        unit_amount: offer ? offer.unit_amount : (s.unit_amount || null) }
    })
}
