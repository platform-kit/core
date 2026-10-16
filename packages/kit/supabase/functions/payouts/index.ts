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
import { admin, appUrl, getPaymentProvider, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { connectAccount, refreshAccount, whatIsDue, sendDue, payoutPolicy, payoutsLive } from '../_shared/payouts.ts'
import { assertPaymentCapabilities } from '../_shared/payment-provider.mjs'
import { hyperswitchClientUrl } from '../_shared/hyperswitch-api.mjs'

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
    return json({ balance, account: acct, lines: lines ?? [], rules: rules ?? [], connect: policy.connect, delay: policy.delay, live: await payoutsLive() })
  }

  if (action === 'connect') {
    /* only ever for themselves: an onboarding link is an identity check, and nobody may start
       somebody else's. A processor that refuses says so in words — Connect not enabled on the
       account is the usual one, and a 500 would leave a person pressing a button that does nothing. */
    try { return json(await connectAccount(user.id, user.email ?? null)) }
    catch (e) { return json({ error: 'the payment processor refused to open an account: ' + String((e as Error).message ?? e), code: 'connect_refused' }, 502) }
  }

  if (action === 'refresh') return json(await refreshAccount(staff && body?.user ? String(body.user) : user.id))

  if (action === 'payout_method_session') {
    try {
      const provider = await getPaymentProvider()
      assertPaymentCapabilities(provider, ['payouts.connected-accounts'])
      if (provider.id !== 'hyperswitch' || !provider.createPaymentMethodSession) {
        return json({ error: 'this payment provider does not support saved payout-method setup' }, 422)
      }
      const { data: account, error } = await admin.from('payout_accounts')
        .select('provider, account_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw new Error(`payout account could not be loaded: ${error.message}`)
      if (!account || (account.provider ?? 'stripe') !== provider.id) {
        return json({ error: 'connect a payout account before adding a payout method' }, 409)
      }
      const site = new URL(appUrl())
      const returnUrl = new URL(String(body?.return_url ?? ''), site.origin)
      const payoutReturn = returnUrl.searchParams.get('payout_return') ?? ''
      const payoutReturnUrl = new URL(payoutReturn, site.origin)
      if (returnUrl.origin !== site.origin ||
          !['/billing', '/app/usage'].includes(returnUrl.pathname) ||
          returnUrl.searchParams.get('payout_setup') !== '1' ||
          returnUrl.searchParams.get('payment_method') !== 'updated' ||
          !payoutReturn.startsWith('/') || payoutReturn.startsWith('//') ||
          payoutReturn.includes('\\') || payoutReturnUrl.origin !== site.origin) {
        return json({ error: 'invalid payout-method return URL' }, 400)
      }
      const session = await provider.createPaymentMethodSession({
        customerId: account.account_id,
        returnUrl: returnUrl.toString(),
      })
      const publishableKey = Deno.env.get('HYPERSWITCH_PUBLISHABLE_KEY')
      const apiBaseUrl = Deno.env.get('HYPERSWITCH_BASE_URL')
      if (!publishableKey || !apiBaseUrl) {
        throw new Error('Hyperswitch payment-method management is missing its public SDK configuration')
      }
      return json({
        payment_method_management: {
          provider: provider.id,
          sdk_authorization: session.sdkAuthorization,
          profile_id: session.profileId,
          publishable_key: publishableKey,
          api_base_url: apiBaseUrl,
          client_url: hyperswitchClientUrl(Deno.env.get('HYPERSWITCH_CLIENT_URL')),
        },
      })
    } catch (error) {
      console.error('payout-method session failed', error)
      return json({
        error: 'payout-method setup could not be opened: ' + String((error as Error).message ?? error),
        code: 'payout_method_session_failed',
      }, 502)
    }
  }

  if (!staff) return json({ error: 'administrators only' }, 403)

  if (action === 'due') return json({ due: await whatIsDue(), live: await payoutsLive() })

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
