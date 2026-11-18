/*
 * POST (the service bearer; run_term_reminders daily) → { sent }
 *
 * A WEEK BEFORE A FIXED TERM ENDS, where nothing follows it (`then: end`, no plan change waiting), the member is told
 * once, so a term never just stops (openspec: payment-plans). A term that continues or renews needs no warning: nothing
 * stops. And a term paid in full whose date has passed is marked ended.
 */
import { admin, json, preflight, isServiceBearer, appUrl } from '@pk/core/lib.ts'
import { offer } from '@pk/core/offers.ts'
import { sendEmail } from '@pk/core/email.ts'
import { fresh } from '@pk/core/compiled.ts'

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'the service bearer' }, 401)
  await fresh()
  const now = new Date(), week = new Date(Date.now() + 7 * 86400_000)
  const { data: due, error } = await admin.from('commitments')
    .select('id, user_id, of_sku, ends_at')
    .eq('membership', true).eq('then', 'end').is('reminded_at', null).is('change_to_sku', null)
    .in('status', ['active', 'ended']).gt('ends_at', now.toISOString()).lte('ends_at', week.toISOString())
  if (error) return json({ error: `terms could not be read: ${error.message}` }, 500)
  let sent = 0
  for (const c of due ?? []) {
    /* claimed first, so two runs never send it twice */
    const { data: claimed } = await admin.from('commitments').update({ reminded_at: new Date().toISOString() }).eq('id', c.id).is('reminded_at', null).select('id')
    if (!claimed?.length) continue
    const { data: who } = await admin.from('profiles').select('email, display_name').eq('id', c.user_id).maybeSingle()
    if (!who?.email) continue
    const o = offer(c.of_sku)
    const ends = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(c.ends_at!))
    if (await sendEmail(who.email, 'term-ending', { name: (who.display_name ?? '').split(' ')[0] ?? '', what: o?.title ?? c.of_sku, ends, url: `${appUrl()}/store/products/${c.of_sku}` })) sent++
  }
  /* a term paid in full is over when its date is: its entitlement expired then, and now its record says so */
  const { data: over } = await admin.from('commitments').update({ status: 'ended', updated_at: new Date().toISOString() })
    .eq('plan', 'full').eq('status', 'active').lte('ends_at', now.toISOString()).select('id')
  return json({ sent, ended: (over ?? []).length })
})
