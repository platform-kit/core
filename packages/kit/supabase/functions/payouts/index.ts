/*
 * THE LEDGER'S DOOR. POST { action }:
 *
 *   a person about themselves — `status` (what they have earned, what is payable and when, what has
 *   been sent, and whether they can be paid at all), `connect` (an onboarding link), `refresh`
 *   (asking the processor whether it has finished with them);
 *
 *   an administrator — `due` (everybody with something payable, and what stands in the way of each),
 *   `send` (one person, or everybody sendable), `sweep` (write the lines the calls since the last
 *   sweep earned; the cron does this hourly and this is for looking now).
 *
 * Nothing here decides what anybody is owed: that is payout_rules and payouts_sweep, and this reads
 * what they wrote. Nobody may send themselves anything.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { connectAccount, refreshAccount, whatIsDue, sendDue, payoutPolicy, payoutsLive } from '../_shared/payouts.ts'

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  let body: any
  try { body = await req.json() } catch { body = {} }
  const action = String(body?.action ?? 'status')
  const roles = await rolesOf(user.id)
  const staff = isAdmin(roles)
  /* ASKING ABOUT SOMEBODY ELSE IS REFUSED, not quietly answered about yourself: a page that shows
     the wrong person's earnings without saying so is worse than one that says no. */
  if (body?.user && String(body.user) !== user.id && !staff) return json({ error: 'administrators only' }, 403)

  if (action === 'status') {
    const who = staff && body?.user ? String(body.user) : user.id
    const [{ data: balance }, acct, policy] = await Promise.all([
      admin.rpc('payout_balance', { p_user: who }),
      refreshAccount(who),
      payoutPolicy(),
    ])
    const { data: lines } = await admin.from('payout_lines')
      .select('id, amount, currency, about, earned_at, payable_at, paid_at, payout_ref, reverses, rule_id')
      .eq('user_id', who).order('earned_at', { ascending: false }).limit(200)
    const { data: rules } = await admin.from('payout_rules').select('*').eq('user_id', who).eq('active', true)
    return json({ balance, account: acct, lines: lines ?? [], rules: rules ?? [], connect: policy.connect, delay: policy.delay, live: payoutsLive })
  }

  if (action === 'connect') {
    /* only ever for themselves: an onboarding link is an identity check, and nobody may start
       somebody else's. A processor that refuses says so in words — Connect not enabled on the
       account is the usual one, and a 500 would leave a person pressing a button that does nothing. */
    try { return json(await connectAccount(user.id, user.email ?? null)) }
    catch (e) { return json({ error: 'the payment processor refused to open an account: ' + String((e as Error).message ?? e), code: 'connect_refused' }, 502) }
  }

  if (action === 'refresh') return json(await refreshAccount(staff && body?.user ? String(body.user) : user.id))

  if (!staff) return json({ error: 'administrators only' }, 403)

  if (action === 'due') return json({ due: await whatIsDue(), live: payoutsLive })

  if (action === 'sweep') {
    const { data, error } = await admin.rpc('payouts_sweep')
    if (error) return json({ error: error.message }, 500)
    return json({ written: Number(data) || 0 })
  }

  if (action === 'send') {
    if (body?.user) return json(await sendDue(String(body.user)))
    const out = []
    for (const d of await whatIsDue()) if (d.sendable) out.push({ user_id: d.user_id, ...(await sendDue(d.user_id)) })
    return json({ runs: out, sent: out.filter((r: any) => r.sent).length })
  }

  return json({ error: 'unknown action' }, 400)
})
