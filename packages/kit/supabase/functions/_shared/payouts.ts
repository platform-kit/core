/*
 * SENDING WHAT IS OWED. The ledger is the database's (payout_rules, payout_lines, payout_accounts,
 * payouts_sweep, payouts_reverse); this is the one place money actually moves, and it is
 * deliberately thin:
 *
 *   NOTHING HERE DECIDES WHAT ANYBODY IS OWED. It reads the lines the sweep wrote, sends their sum
 *   and writes back what was sent. A transfer that fails leaves every line exactly as it was, so the
 *   next run sends it again — and a transfer that succeeded is written down before anything else
 *   happens, because the one unrecoverable fault here is money sent and not recorded.
 *
 *   NO CARD AND NO BANK DETAIL EVER REACHES THIS DATABASE. The processor holds them; we keep its
 *   account reference and whether payout setup is complete. Individual payouts can still be refused.
 *
 * With no keys — or PAYOUTS_MOCK=1 locally — the site still earns, still keeps its ledger and says
 * which of the two it is doing; nothing is silently skipped.
 */
import { admin, getPaymentProvider, stripeLive, appUrl } from './lib.ts'
import { assertPaymentCapabilities, PaymentProviderError, payoutStatusIsSettled } from './payment-provider.mjs'

export const payoutsMock = /^(1|true|yes|on)$/i.test(Deno.env.get('PAYOUTS_MOCK') ?? '')
const providerIsLive = (providerId: string) => !payoutsMock && (providerId !== 'stripe' || stripeLive)
export const payoutsLive = async () => providerIsLive((await getPaymentProvider()).id)

/* the site's two answers about paying people, read where the projection put them */
export async function payoutPolicy(): Promise<{ connect: 'own' | 'managed'; delay: number }> {
  const { data } = await admin.from('app_settings').select('key, value').in('key', ['provider_connect', 'provider_delay'])
  const at = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value ?? null
  return { connect: at('provider_connect') === 'own' ? 'own' : 'managed', delay: Number(at('provider_delay') ?? 43200) }
}

/*
 * THE ACCOUNT. Two arrangements, and they are two legal positions rather than a preference: the
 * processor onboards the provider (an Express account — it holds the identity checks and files the
 * reporting), or the provider brings an account they already hold (a Standard one — theirs). The
 * third arrangement, where this site collects on their behalf and reports it, would make the
 * operator a payment facilitator; build/deploy-checks.mjs refuses it by name.
 */
export async function connectAccount(userId: string, email: string | null) {
  const provider = await getPaymentProvider()
  assertPaymentCapabilities(provider, ['payouts.connected-accounts'])
  if (!provider.createPayoutAccount) {
    throw new Error(`payment provider "${provider.id}" cannot onboard connected accounts`)
  }
  const { connect } = await payoutPolicy()
  const { data: row } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (row && (row.provider ?? 'stripe') !== provider.id) {
    throw new Error(`connected payout account belongs to provider "${row.provider}", not "${provider.id}"`)
  }
  const live = providerIsLive(provider.id)
  if (!live) {
    /* the mock connects in one step and says so, so every surface can be walked with no account */
    const id = row?.account_id ?? 'acct_mock_' + userId.replace(/-/g, '').slice(0, 16)
    const { error } = await admin.from('payout_accounts').upsert({
      user_id: userId, provider: provider.id, account_id: id, kind: connect, ready: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) throw new Error(`mock payout account could not be saved: ${error.message}`)
    return { mock: true, url: null, account_id: id, ready: true }
  }
  const account = await provider.createPayoutAccount({
    ...(row?.account_id && !String(row.account_id).startsWith('acct_mock_') ? { accountId: row.account_id } : {}),
    userId,
    ...(email ? { email } : {}),
    kind: connect,
    refreshUrl: appUrl() + '/app/coaching?connect=again',
    returnUrl: appUrl() + '/app/coaching?connect=done',
  })
  const { error } = await admin.from('payout_accounts').upsert({
    user_id: userId,
    provider: provider.id,
    account_id: account.accountId,
    kind: connect,
    ready: account.ready,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw new Error(`connected payout account could not be saved: ${error.message}`)
  return { mock: false, url: account.onboardingUrl, account_id: account.accountId, ready: account.ready }
}

/* WHETHER THE PROCESSOR SAYS THEY MAY BE PAID. Connecting is not the same as having finished, and
   somebody half way through should be told which of the two they are. */
export async function refreshAccount(userId: string) {
  const provider = await getPaymentProvider()
  const { data: row } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!row) return { connected: false, ready: false }
  if ((row.provider ?? 'stripe') !== provider.id) {
    throw new Error(`connected payout account belongs to provider "${row.provider}", not "${provider.id}"`)
  }
  if (!providerIsLive(provider.id) || String(row.account_id).startsWith('acct_mock_')) {
    return { connected: true, ready: row.ready, mock: true }
  }
  assertPaymentCapabilities(provider, ['payouts.connected-accounts'])
  if (!provider.retrievePayoutAccount) {
    throw new Error(`payment provider "${provider.id}" cannot retrieve connected-account status`)
  }
  const account = await provider.retrievePayoutAccount(row.account_id)
  const ready = account.ready
  if (ready !== row.ready) await admin.from('payout_accounts').update({ ready, updated_at: new Date().toISOString() }).eq('user_id', userId)
  return { connected: true, ready, details: account.detailsSubmitted }
}

/* WHO IS OWED SOMETHING NOW: the released, unpaid lines gathered per person, with what stands in the
   way of paying them said rather than implied. */
export async function whatIsDue() {
  const { data: lines } = await admin.from('payout_lines').select('user_id, amount, currency')
    .is('paid_at', null).lte('payable_at', new Date().toISOString())
  const by = new Map<string, { user_id: string; amount: number; currency: string }>()
  for (const l of lines ?? []) {
    const at = by.get(l.user_id) ?? { user_id: l.user_id, amount: 0, currency: l.currency ?? 'usd' }
    at.amount += Number(l.amount) || 0
    by.set(l.user_id, at)
  }
  const ids = [...by.keys()]
  if (!ids.length) return []
  const { data: people } = await admin.from('profiles').select('id, display_name, first_name, username, email').in('id', ids)
  const { data: accts } = await admin.from('payout_accounts').select('user_id, account_id, kind, ready').in('user_id', ids)
  return [...by.values()].map((d) => {
    const p = (people ?? []).find((x: any) => x.id === d.user_id)
    const a = (accts ?? []).find((x: any) => x.user_id === d.user_id)
    return {
      ...d,
      name: p?.display_name || p?.first_name || (p?.username ? '@' + p.username : null), email: p?.email ?? null,
      connected: !!a, ready: !!a?.ready, kind: a?.kind ?? null,
      /* A REVERSAL CAN LEAVE A PERSON OWED NOTHING OR LESS. Nothing is sent, and it is not a demand:
         it stands against whatever they earn next. */
      sendable: d.amount > 0 && !!a?.ready,
      why: d.amount <= 0 ? 'a reversal stands against what is earned next'
        : !a ? 'no account connected yet'
        : !a.ready ? 'the account is connected but the processor has not finished with it'
        : null,
    }
  }).sort((a, b) => b.amount - a.amount)
}

/*
 * SEND ONE PERSON WHAT IS DUE. The lines are claimed FIRST — stamped with a reference nothing has
 * sent yet — and only then is the transfer made. An uncertain Hyperswitch result keeps that
 * reference so a retry can retrieve the same payout instead of creating another one.
 */
export async function sendDue(userId: string) {
  const now = new Date().toISOString()
  const { data: lines } = await admin.from('payout_lines').select('id, amount, currency, payout_ref')
    .eq('user_id', userId).is('paid_at', null).lte('payable_at', now)
  const rows = lines ?? []
  if (!rows.length) return { sent: 0, amount: 0, reason: 'nothing is payable' }
  const existingRef = rows.find((line) => typeof line.payout_ref === 'string' && line.payout_ref)?.payout_ref ?? null
  const payoutRows = existingRef
    ? rows.filter((line) => line.payout_ref === existingRef)
    : rows.filter((line) => !line.payout_ref)
  const amount = payoutRows.reduce((n, line) => n + (Number(line.amount) || 0), 0)
  if (!payoutRows.length || amount <= 0) {
    return { sent: 0, amount, reason: payoutRows.length ? 'a reversal stands against what is earned next' : 'payout lines are already being reconciled' }
  }
  const provider = await getPaymentProvider()
  assertPaymentCapabilities(provider, ['payouts.connected-accounts'])
  if (!provider.createPayout) throw new Error(`payment provider "${provider.id}" cannot create payouts`)
  const { data: acct } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!acct || !acct.ready) return { sent: 0, amount, reason: acct ? 'the account is not ready' : 'no account connected' }
  if ((acct.provider ?? 'stripe') !== provider.id) {
    throw new Error(`connected payout account belongs to provider "${acct.provider}", not "${provider.id}"`)
  }
  const live = providerIsLive(provider.id)
  const currency = payoutRows[0].currency ?? 'usd'
  const ref = existingRef ?? (live ? 'po_' : 'po_mock_') + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const ids = payoutRows.map((line) => line.id)

  if (!existingRef) {
    const { data: claimed, error: claimErr } = await admin.from('payout_lines')
      .update({ payout_ref: ref })
      .in('id', ids)
      .is('paid_at', null)
      .is('payout_ref', null)
      .select('id')
    if (claimErr) return { sent: 0, amount, reason: 'the ledger refused the claim: ' + claimErr.message }
    if ((claimed ?? []).length !== ids.length) {
      if (claimed?.length) {
        const { error } = await admin.from('payout_lines')
          .update({ payout_ref: null })
          .in('id', claimed.map((line) => line.id))
          .is('paid_at', null)
        if (error) throw new Error(`partial payout claim could not be released: ${error.message}`)
      }
      return { sent: 0, amount, reason: 'another payout run already claimed these lines' }
    }
  }

  try {
    let result: { payoutId: string; status: string } | null = null
    if (live) {
      result = await provider.createPayout({
        accountId: acct.account_id,
        amountMinor: amount,
        currency,
        idempotencyKey: ref,
        metadata: { user_id: userId, lines: String(ids.length), ref },
      })
    }
    if (provider.id === 'hyperswitch' && result && !payoutStatusIsSettled(result.status)) {
      return {
        sent: 0,
        amount,
        currency,
        ref,
        status: result.status,
        reason: `Hyperswitch payout is ${result.status}; its ledger claim is retained for reconciliation`,
      }
    }
    const { error: paidError } = await admin.from('payout_lines')
      .update({ paid_at: new Date().toISOString() })
      .in('id', ids)
    if (paidError) {
      return { sent: 0, amount, reason: 'the payout was sent but the ledger could not record it: ' + paidError.message }
    }
    return { sent: ids.length, amount, currency, ref, mock: !live }
  } catch (e) {
    const uncertain = provider.id === 'hyperswitch' &&
      e instanceof PaymentProviderError && e.status >= 500
    if (!uncertain) {
      const { error } = await admin.from('payout_lines')
        .update({ payout_ref: null })
        .in('id', ids)
        .is('paid_at', null)
      if (error) throw new Error(`payout failed and its ledger claim could not be released: ${error.message}`)
    }
    return { sent: 0, amount, reason: 'the transfer was refused: ' + String((e as Error).message ?? e) }
  }
}
