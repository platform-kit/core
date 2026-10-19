/*
 * The site's own part of a session, whoever schedules it: the rules — which booking type is
 * whose (`requires`, `below`), how many a week or a month, a paid type's credit — and the one
 * judge that allows or refuses a booking (book-session asks it before anything exists, the
 * cal-webhook asks it about a booking that arrived some other way); the row a booking is mirrored
 * onto (`bookings`, one shape whether the site or cal.com made it); a paid session's credit and
 * its week of chat. The scheduling itself — the open times, a booking, a move, a cancellation —
 * is a provider behind one shape in ./schedulers (the site's own, and cal.com's), picked per
 * type by `schedulerOf`; nothing here names one.
 *
 * The types are the sessions in catalog.json (content/sessions/*.md, via build/catalog.mjs).
 */
import { admin } from './lib.ts'
import { offer } from './offers.ts'
import { of, onRefresh } from './compiled.ts'
import { admits } from './sessions/admits.js'
import { lengthChosen } from './sessions/page.js'

export type Where = { kind: 'video' | 'link' | 'place' | 'phone' | 'none'; url?: string; name?: string; address?: string; number?: string }
export type Session = { title: string; slug: string; event: string; scheduler: 'native' | 'cal'; username: string | null; requires: string | string[]; below: string | null; weekly: number; monthly: number; sku: string | null; duration: number; hosts: string[]; seats: number; buffer: number; notice: number; where: Where; record: boolean; hours?: any; repeats?: any }
/* THE CATALOG, as the deployment has it: the file the build shipped, or the row a publish wrote
   where nothing rebuilds (see ./compiled.ts). These are `let` and re-derived on a refresh because
   an ESM export is a live binding — every reader below and in every other module sees the new value
   without knowing this happened. */
export let SESSIONS: Session[] = []
export let TIERS: Record<string, number> = {}
/* a tier's own allowances: what a membership offer lists as sessions included, by type slug */
export let ALLOWANCES: Record<string, Record<string, { weekly: number; monthly: number }>> = {}
onRefresh(() => {
  const catalog = of<Record<string, any>>('catalog')
  SESSIONS = catalog.sessions ?? []
  TIERS = catalog.tiers ?? {}
  ALLOWANCES = catalog.allowances ?? {}
})
export const sessionBySlug = (slug: string | null) => (slug ? SESSIONS.find((s) => s.slug === slug) ?? null : null)
export const sessionOf = (event: string | null) => (event ? SESSIONS.find((s) => s.event === event) ?? null : null)

/*
 * A PROVIDER'S OWN OFFERING wears a booking type's shape, so the judge, the scheduler, the row, the
 * confirmation, the invitation, the reminders, the room and the follow-up all deal with one kind of
 * thing and nothing else in this directory knows an offering exists. The shape itself is pure and
 * shared with the browser (./sessions/offering.js), because the two sides disagreeing about what an
 * offering IS would mean a surface offering a session the judge will refuse.
 */
import { OFFERING, isOffering, offeringId, offeringType as offeringAsType } from './sessions/offering.js'
import { parseManaged, managedCopy } from './sessions/managed.js'
/* re-exported as well as imported: a bare re-export does not bring the binding into THIS module's
   scope, and the reader below calls offeringId — which threw at runtime and nowhere earlier. */
export { OFFERING, isOffering, offeringId, offeringAsType }

/*
 * ONLY WHAT MAY BE BOOKED NOW. A retired offering, one still waiting to be read, and one whose
 * provider is on terms they have not agreed to are all the same answer: nothing. A reader who
 * reaches an old address is told it is not available rather than shown a calendar with no times in
 * it — which is why this returns null rather than a type with no hours.
 *
 * `any: true` is for a booking that already exists: the confirmation, the room and the follow-up of
 * a call somebody booked before it was retired must still work, because retiring is about new
 * bookings and nothing else.
 */
export async function offeringType(event: string | null, opts: { any?: boolean } = {}): Promise<Session | null> {
  const id = offeringId(event)
  if (!id) return null
  const { data } = await admin.from('provider_offerings').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  if (!opts.any) {
    if (data.state !== 'live') return null
    const { data: may } = await admin.rpc('provider_may_sell', { p_user: data.provider_id })
    if (may === false) return null
  }
  const { data: p } = await admin.from('profiles').select('email').eq('id', data.provider_id).maybeSingle()
  return offeringAsType(data, { hostEmail: p?.email ?? null }) as Session
}

/*
 * A MANAGED TYPE'S COPY, resolved from its address: the type as written, given that member as its
 * one host. Nothing was written down for it — the copy is computed here, from the file and the row
 * that says they are in the team.
 *
 * A MEMBER WHO HAS LEFT HAS NO COPY, so a new booking is refused; `any: true` resolves it anyway,
 * because the bookings already made against it must still be confirmed, joined and followed up.
 * Retiring is about new bookings and nothing else.
 */
export async function managedType(event: string | null, opts: { any?: boolean } = {}): Promise<Session | null> {
  const m = parseManaged(event)
  if (!m) return null
  const base = sessionOf(m.slug)
  if (!base || (base as any).assign !== 'managed' || !(base as any).team) return null
  const { data: p } = await admin.from('profiles').select('id, email, username, display_name').ilike('username', m.username).maybeSingle()
  if (!p) return null
  if (!opts.any) {
    const { data: row } = await admin.from('team_members').select('user_id').eq('team', (base as any).team).eq('user_id', p.id).maybeSingle()
    if (!row) return null
  }
  return managedCopy(base, { email: p.email, username: p.username, name: p.display_name }) as Session
}

/* THE ONE RESOLVER. A site's declared type, a member's copy of a managed one, else a provider's
   offering; nothing else asks which. */
export async function typeFor(event: string | null, opts: { any?: boolean } = {}): Promise<Session | null> {
  return sessionOf(event) ?? await managedType(event, opts) ?? await offeringType(event, opts)
}


/* the row, from the API's own answer, so the sheet shows the session the moment
   it is made; the webhook's fuller projection lands over it a moment later */
export async function mirror(b: any, user_id: string | null, s: Session | null, credit_id: string | null = null, checkoutIdentity: string | null = null, stripeCheckoutSessionId: string | null = null) {
  /* cal.com's answer; a native booking is written by its scheduler and never comes here */
  const host = (b.hosts ?? [])[0] ?? {}
  const att = (b.attendees ?? [])[0] ?? {}
  const { data: coach } = host.email ? await admin.from('profiles').select('id').ilike('email', host.email).maybeSingle() : { data: null }
  await admin.from('bookings').upsert({
    uid: b.uid, user_id,
    checkout_identity: checkoutIdentity ?? b.metadata?.checkout_identity ?? b.metadata?.stripe_checkout_session_id ?? null,
    stripe_checkout_session_id: stripeCheckoutSessionId ?? b.metadata?.stripe_checkout_session_id ?? null,
    email: att.email ?? null, name: att.name ?? null,
    provider_id: coach?.id ?? null, provider_email: host.email ? String(host.email).toLowerCase() : null,
    attendee_emails: (b.attendees ?? []).map((a: any) => String(a.email || '').toLowerCase()).filter(Boolean),
    title: b.title ?? s?.title ?? null, event: b.eventType?.slug ?? s?.event ?? null,
    start_at: b.start ?? null, end_at: b.end ?? null, join_url: b.meetingUrl ?? null,
    status: b.status === 'pending' ? 'pending' : 'accepted', payload: b, provider: 'cal', type: s?.slug ?? null, updated_at: new Date().toISOString(),
    ...(credit_id ? { credit_id } : {}),
  }, { onConflict: 'uid' })
}

/* ---- the rules ---- */
const WEEK = 7 * 864e5, MONTH = 30 * 864e5
/* the reader's live tiers, and the highest one's rank */
export async function tiersOf(user_id: string | null): Promise<{ rank: number; tiers: string[] }> {
  if (!user_id) return { rank: 0, tiers: [] }
  const { data } = await admin.from('entitlements').select('tier, expires_at').eq('user_id', user_id).eq('kind', 'class').eq('key', 'subscribed').eq('active', true)
  const now = Date.now()
  const tiers = (data ?? []).filter((e: any) => e.tier && (!e.expires_at || new Date(e.expires_at).getTime() > now)).map((e: any) => e.tier as string)
  return { rank: Math.max(0, ...tiers.map((t) => TIERS[t] ?? 0)), tiers }
}
export async function rankOf(user_id: string | null): Promise<number> { return (await tiersOf(user_id)).rank }
/* what the reader's tiers say of a type: the listing with the highest rank wins; null when none lists it */
export const allowanceOf = (tiers: string[], s: Session) => {
  const listed = tiers.filter((t) => ALLOWANCES[t] && ALLOWANCES[t][s.slug]).sort((a, b) => (TIERS[b] ?? 0) - (TIERS[a] ?? 0))
  return listed.length ? { tier: listed[0], ...ALLOWANCES[listed[0]][s.slug] } : null
}
const rankOfTier = (t: string | null) => (t ? TIERS[t] ?? 0 : 0)
export const forRank = (s: Session, rank: number, signed: boolean, tiers: string[] = []) => {
  if (allowanceOf(tiers, s)) return true   /* a tier that lists the type admits it, whatever the type's own rules say */
  /* ONE RULE, shared with the app's picker (src/lib/booking.js): two sides of a gate that
     disagree are not a gate. */
  return admits(s, { tiers, rank, signed, ranks: TIERS })
}
/* the credits a reader holds for a paid session: one entitlement row per purchase */
export async function credits(user_id: string, sku: string) {
  const o = offer(sku)
  const { data } = await admin.from('entitlements').select('id').eq('user_id', user_id).eq('kind', 'product').eq('key', 'session:' + (o?.key ?? sku)).eq('active', true)
  return (data ?? []).map((r: any) => r.id as string)
}

export type Verdict = { ok: true; session: Session; credit: string | null } | { ok: false; reason: 'unknown' | 'guest' | 'not-included' | 'over' | 'unpaid'; session: Session | null; next?: string; allowance?: string }
/* may this reader book (or keep) this event type now? `except` is a booking of
   theirs not to count (the one being judged, or the one being rescheduled) */
export async function judge(event: string | null, user_id: string | null, email: string | null, except: string | null, minutes = 0): Promise<Verdict> {
  const s = await typeFor(event)
  if (!s) return { ok: false, reason: 'unknown', session: null }
  const { rank, tiers } = await tiersOf(user_id)
  const al = allowanceOf(tiers, s)
  /*
   * THE JUDGE ASKS `forRank()`, WHICH IS ALREADY THE ONE RULE — `admits()` shared with the app's
   * picker, plus the listing only the server holds. It was briefly changed to ask the ability
   * instead, for the sake of a site being able to narrow booking in one place; the change was
   * measured and undone. Fourteen functions import this module — every Stripe and LiveKit webhook
   * among them — so the ability would have carried @casl/ability into all of them, and it would
   * have bought nothing yet: a site's own rules are not assembled beside the functions, so the
   * server can only ever run the kit's, which `forRank` already is. When the site's rules are
   * carried into `_shared` the seam is worth its weight; until then this is cost without benefit.
   */
  if (!forRank(s, rank, !!user_id, tiers)) return { ok: false, reason: rank === 0 && s.requires !== 'anyone' && s.requires !== 'guest' ? 'guest' : 'not-included', session: s }
  const now = Date.now()
  /* the tier's own counts when it lists the type, the type's otherwise; a booking a host made for them is never counted */
  const weekly = al ? al.weekly : s.weekly, monthly = al ? al.monthly : s.monthly
  let q = admin.from('bookings').select('uid, start_at').eq('event', event!).in('status', ['pending', 'accepted', 'ended']).is('made_by', null)
  q = user_id ? q.eq('user_id', user_id) : q.ilike('email', email ?? '')
  if (except) q = q.neq('uid', except)
  const { data: others } = await q
  for (const [n, ms, word] of [[weekly, WEEK, 'one a week'], [monthly, MONTH, 'one a month']] as const) {
    if (!(n > 0)) continue
    const counted = (others ?? []).filter((b: any) => b.start_at && new Date(b.start_at).getTime() >= now - ms).sort((a: any, b: any) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    if (counted.length >= n) return { ok: false, reason: 'over', session: s, next: new Date(new Date(counted[0].start_at).getTime() + ms).toISOString(), allowance: n === 1 ? word : `${n} a ${word.split(' ').pop()}` }
  }
  /* a paid session is booked with a credit — unless the reader's tier includes it */
  /* at the length being booked: a length may carry a price of its own, and a credit for the type's
     default is not a credit for a dearer length */
  const sku = lengthChosen(s, minutes).sku || s.sku
  if (sku && !al) {
    const have = user_id ? await credits(user_id, sku) : []
    if (!have.length) return { ok: false, reason: 'unpaid', session: s }
    return { ok: true, session: s, credit: have[0] }
  }
  return { ok: true, session: s, credit: null }
}
export const spendCredit = (id: string) => admin.from('entitlements').update({ active: false }).eq('id', id)
export const returnCredit = (id: string) => admin.from('entitlements').update({ active: true }).eq('id', id)

/* a paid session comes with a week of chat with its coach, from the booking until a week after the
   session ends — read from the booking itself by chat_session_with (50-chat.sql), so a move re-dates it
   and a cancel ends it with nothing written here. It is not a membership. */
