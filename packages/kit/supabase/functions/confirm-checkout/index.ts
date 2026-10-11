/*
 * POST { session } → the ledger written from the Checkout Session the buyer just
 * came back from, and { ok, mode } — or { pending: true } while Stripe still has
 * it unpaid. The webhook writes the same rows a moment later (every write is an
 * upsert by Stripe's id, so the two never disagree); this is the buyer's own
 * confirmation, so what they paid for is theirs the instant they land, before the
 * webhook — and locally, without a `stripe listen` forwarding it at all. The
 * session must be theirs: its metadata names the user, and only that user may
 * confirm it.
 */
import { stripe, stripeConfigured, stripeMock, isMockId, stripeUnconfigured, json, preflight, getUser } from '../_shared/lib.ts'
import { checkoutCompleted, subscriptionChanged } from '../_shared/ledger.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  /* a guest's session (metadata.guest) is confirmed with no user: the ledger's writes are
     idempotent and say only what Stripe says was paid */
  const user = await getUser(req)
  if (!stripeConfigured) return stripeUnconfigured()
  const body = await req.json().catch(() => ({}))
  const id = String(body?.session ?? '')
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: 'no session' }, 400)
  if (stripeMock || isMockId(id)) return json({ ok: true, mock: true })   /* the mock wrote the ledger as it answered */
  try {
    const s: any = await stripe.checkout.sessions.retrieve(id, { expand: ['subscription', 'line_items'] })
    const owner = s.metadata?.user_id ?? s.client_reference_id ?? null
    if (owner ? !user || owner !== user.id : s.metadata?.guest !== '1') return json({ error: user ? 'not your session' : 'sign in first' }, user ? 403 : 401)
    if (s.status !== 'complete' || (s.mode === 'payment' && s.payment_status !== 'paid')) return json({ pending: true, status: s.status, payment_status: s.payment_status })
    await checkoutCompleted(s)
    if (s.mode === 'subscription' && s.subscription && typeof s.subscription === 'object') await subscriptionChanged(s.subscription)
    return json({ ok: true, mode: s.mode })
  } catch (e) {
    return json({ error: `Stripe: ${(e as any)?.message ?? e}` }, 502)
  }
})
