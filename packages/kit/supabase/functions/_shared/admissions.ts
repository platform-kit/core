/*
 * ADMISSIONS: WHERE A PERSON STANDS WITH AN OFFER THAT GATES ITS CHECKOUT (openspec: applications-and-intro-calls).
 *
 * The record and its paths are in 47-admissions.sql; this is what the functions do around it: start one when an
 * application arrives, move one when a reviewer decides or a call is booked, and send the four emails (received,
 * to the applicant and to the reviewers; approved; declined). The reviewers are the site's administrators and the
 * hosts of the offer's call. Nothing here throws into the caller: an email that fails is logged, and the
 * admission stands.
 */
import { admin, appUrl } from './lib.ts'
import { offer } from './offers.ts'
import { of } from './compiled.ts'
import { sendEmail } from './email.ts'

export type Gate = { call: string | null; callRequired: boolean; apply: string | null; review: 'person' | 'none' | null; openDays: number; gated: boolean }
export const gateOf = (sku: string): Gate | null => ((offer(sku) as any)?.before as Gate) ?? null

/* the offers whose application is this form, the one the page named first when it named one */
export function offersApplyingWith(form: string, named = ''): string[] {
  const all = Object.values<any>(of<Record<string, any>>('catalog').offers ?? {}).filter((o) => o?.before?.apply === form).map((o) => o.sku as string)
  return named && all.includes(named) ? [named] : all
}
/* the offer whose call is this booking type */
export function offerCalling(type: string): string | null {
  const o = Object.values<any>(of<Record<string, any>>('catalog').offers ?? {}).find((x) => x?.before?.call === type)
  return o ? o.sku : null
}

async function person(userId: string): Promise<{ email: string; name: string } | null> {
  const { data } = await admin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle()
  return data?.email ? { email: data.email, name: String(data.display_name ?? '').split(' ')[0] ?? '' } : null
}
/* who reviews an offer's applications: every administrator, and whoever hosts its call */
export async function reviewersOf(sku: string): Promise<string[]> {
  const { data } = await admin.from('profiles').select('email').eq('role', 'admin')
  const out = new Set<string>((data ?? []).map((r: any) => String(r.email || '').toLowerCase()).filter(Boolean))
  const call = gateOf(sku)?.call
  if (call) {
    const t = (of<Record<string, any>>('catalog').sessions ?? []).find((s: any) => s.slug === call)
    for (const h of t?.hosts ?? []) out.add(String(h).toLowerCase())
  }
  return [...out]
}
/* whether this person may review this offer's applications */
export async function mayReview(userId: string, sku: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('email, role').eq('id', userId).maybeSingle()
  if (!data) return false
  if (data.role === 'admin') return true
  return (await reviewersOf(sku)).includes(String(data.email || '').toLowerCase())
}

const title = (sku: string) => String((offer(sku) as any)?.title || sku)
const checkoutUrl = (sku: string) => `${appUrl()}/checkout/${encodeURIComponent(sku)}`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

/* an application arrives: the admission starts, and the applicant and the reviewers hear of it */
export async function applied(userId: string, sku: string, responseId: string) {
  const g = gateOf(sku)
  if (!g || !g.apply) return null
  const open = g.review === 'none' && !g.callRequired
  const { data: a, error } = await admin.rpc('admission_apply', { p_user: userId, p_sku: sku, p_response: responseId, p_open: open, p_open_days: g.openDays || 0 })
  if (error) { console.warn('admission: apply', error.message); return null }
  const who = await person(userId)
  if (who) {
    if (open) await sendEmail(who.email, 'application-approved', { name: who.name, what: title(sku), note: '', until: day(a?.open_until ?? null), url: checkoutUrl(sku) }).catch(() => false)
    else await sendEmail(who.email, 'application-received', { name: who.name, what: title(sku), url: checkoutUrl(sku) }).catch(() => false)
  }
  if (!open) for (const r of await reviewersOf(sku)) await sendEmail(r, 'application-review', { who: who?.email ?? userId, what: title(sku), url: `${appUrl()}/admin/applications` }).catch(() => false)
  return a
}

/* a reviewer decides: approve (open, or approved where a required call follows), decline, close or reopen */
export async function decide(id: string, act: 'approve' | 'decline' | 'close' | 'reopen', by: string, note = '') {
  const { data: cur } = await admin.from('admissions').select('*').eq('id', id).maybeSingle()
  if (!cur) return { error: 'no such application' }
  const g = gateOf(cur.sku)
  const to = act === 'approve' ? (g?.callRequired && !cur.booking_id ? 'approved' : 'open')
    : act === 'decline' ? 'declined' : act === 'close' ? 'closed' : 'open'
  const { data: a, error } = await admin.rpc('admission_move', { p_id: id, p_to: to, p_by: by, p_note: note || null, p_open_days: g?.openDays || 0 })
  if (error) return { error: error.message }
  const who = await person(cur.user_id)
  if (who && (act === 'approve' || act === 'reopen')) await sendEmail(who.email, 'application-approved', { name: who.name, what: title(cur.sku), note: note || '', until: day(a?.open_until ?? null), url: checkoutUrl(cur.sku) }).catch(() => false)
  if (who && act === 'decline') await sendEmail(who.email, 'application-declined', { name: who.name, what: title(cur.sku), note: note || '', url: `${appUrl()}/pricing` }).catch(() => false)
  return { admission: a }
}

/* a call booked for an offer that names it: kept on the admission */
export async function callBooked(userId: string, type: string, bookingId: string) {
  const sku = offerCalling(type)
  if (!sku) return null
  const g = gateOf(sku)!
  const { data, error } = await admin.rpc('admission_booked', { p_user: userId, p_sku: sku, p_booking: bookingId, p_required: !!g.callRequired })
  if (error) { console.warn('admission: booked', error.message); return null }
  return data
}
/* the same, for a booking cal.com made outside the app: matched by its event type's slug */
export async function callBookedByEvent(userId: string, event: string, bookingUid: string) {
  const t = (of<Record<string, any>>('catalog').sessions ?? []).find((s: any) => s.event === event || s.slug === event)
  return t ? callBooked(userId, t.slug, bookingUid) : null
}
