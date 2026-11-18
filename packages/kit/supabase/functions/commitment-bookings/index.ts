/*
 * POST (the service bearer; run_commitment_bookings every five minutes) → { told, cancelled }
 *
 * A MISSED PAYMENT ON A PLAN OR A TERM, AS IT TOUCHES BOOKINGS (openspec: payment-plans). The sessions module's half
 * of a commitment, so a site without sessions has none of it:
 *
 *   the hosts of the buyer's upcoming bookings are told once, when the payment is first missed;
 *   where the offer named a grace period (missed.cancelBookings), every upcoming booking of the buyer's is cancelled
 *   once the payment has been outstanding that long — through the ordinary cancellation, whichever scheduler holds
 *   it, with the reason recorded, the person and the host told as any cancellation tells them, and nothing given
 *   back. Bookings cancelled this way stay cancelled when the payment is made.
 */
import { admin, json, preflight, isServiceBearer, appUrl } from '../_shared/lib.ts'
import { cancelBooking } from '../_shared/booking.ts'
import { offer } from '../_shared/offers.ts'
import { sendEmail } from '../_shared/email.ts'
import { fresh } from '../_shared/compiled.ts'

const REASON = 'A payment on the plan that includes this booking is outstanding.'

const money = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((Number(minor) || 0) / 100) }
  catch { return `${((Number(minor) || 0) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}` }
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'the service bearer' }, 401)
  await fresh()
  const { data: due, error } = await admin.from('commitments')
    .select('id, user_id, of_sku, amount_minor, currency, status, missed_at, hosts_told_at, cancel_bookings_after_minutes, bookings_cancelled_at')
    .not('missed_at', 'is', null).in('status', ['active', 'restricted', 'defaulted'])
  if (error) return json({ error: `commitments could not be read: ${error.message}` }, 500)
  let told = 0, cancelled = 0
  const now = Date.now()
  for (const c of due ?? []) {
    const { data: upcoming } = await admin.from('bookings')
      .select('uid, user_id, event, credit_id, provider_email, host_id, title, start_at')
      .eq('user_id', c.user_id).in('status', ['accepted', 'pending']).gt('start_at', new Date().toISOString())
    if (!upcoming?.length) continue
    const { data: buyer } = await admin.from('profiles').select('email').eq('id', c.user_id).maybeSingle()
    /* the hosts, told once of the miss */
    if (!c.hosts_told_at) {
      const hostIds = [...new Set(upcoming.map((b: any) => b.host_id).filter(Boolean))]
      const { data: hostRows } = hostIds.length ? await admin.from('profiles').select('email').in('id', hostIds) : { data: [] }
      const hosts = new Set([...upcoming.map((b: any) => b.provider_email), ...(hostRows ?? []).map((h: any) => h.email)].filter(Boolean).map((e: string) => e.toLowerCase()))
      const what = offer(c.of_sku)?.title ?? c.of_sku
      for (const h of hosts) await sendEmail(h, 'payment-missed-notice', { who: buyer?.email ?? c.user_id, what, amount: money(c.amount_minor, c.currency), restricted: c.status === 'restricted' ? 'yes' : '' })
      await admin.from('commitments').update({ hosts_told_at: new Date().toISOString() }).eq('id', c.id)
      told += hosts.size
    }
    /* the grace period passed: every upcoming booking, cancelled with nothing given back */
    const grace = c.cancel_bookings_after_minutes
    if (grace != null && !c.bookings_cancelled_at && new Date(c.missed_at!).getTime() + grace * 60_000 <= now) {
      for (const b of upcoming) {
        try { await cancelBooking(b as any, { email: '', role: 'admin' }, REASON, { keepCredit: true }); cancelled++ }
        catch (e) { console.warn(`commitment-bookings: ${b.uid} not cancelled —`, (e as Error)?.message ?? e) }
      }
      await admin.from('commitments').update({ bookings_cancelled_at: new Date().toISOString() }).eq('id', c.id)
    }
  }
  return json({ told, cancelled, url: appUrl() })
})
