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
 *   NO CARD AND NO BANK DETAIL EVER REACHES THIS DATABASE. The processor holds them; we keep the
 *   reference it gave us and a flag saying whether it says the person can be paid yet.
 *
 * With no keys — or PAYOUTS_MOCK=1 locally — the site still earns, still keeps its ledger and says
 * which of the two it is doing; nothing is silently skipped.
 */
import { admin, stripe, stripeLive, appUrl } from './lib.ts'

export const payoutsMock = /^(1|true|yes|on)$/i.test(Deno.env.get('PAYOUTS_MOCK') ?? '')
export const payoutsLive = stripeLive && !payoutsMock

/* the site's two answers about paying people, read where the projection put them */
export async function payoutPolicy() {
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
  const { connect } = await payoutPolicy()
  const { data: row } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!payoutsLive) {
    /* the mock connects in one step and says so, so every surface can be walked with no account */
    const id = row?.account_id ?? 'acct_mock_' + userId.replace(/-/g, '').slice(0, 16)
    await admin.from('payout_accounts').upsert({ user_id: userId, provider: 'stripe', account_id: id, kind: connect, ready: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    return { mock: true, url: null, account_id: id, ready: true }
  }
  let id = row?.account_id && !row.account_id.startsWith('acct_mock_') ? row.account_id : null
  if (!id) {
    const acct = await stripe.accounts.create({
      type: connect === 'own' ? 'standard' : 'express',
      email: email ?? undefined,
      metadata: { user_id: userId },
    })
    id = acct.id
    await admin.from('payout_accounts').upsert({ user_id: userId, provider: 'stripe', account_id: id, kind: connect, ready: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }
  /* the link is short-lived and single-use by design: it is asked for each time rather than kept */
  const link = await stripe.accountLinks.create({
    account: id,
    refresh_url: appUrl() + '/app/coaching?connect=again',
    return_url: appUrl() + '/app/coaching?connect=done',
    type: 'account_onboarding',
  })
  return { mock: false, url: link.url, account_id: id, ready: false }
}

/* WHETHER THE PROCESSOR SAYS THEY MAY BE PAID. Connecting is not the same as having finished, and
   somebody half way through should be told which of the two they are. */
export async function refreshAccount(userId: string) {
  const { data: row } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!row) return { connected: false, ready: false }
  if (!payoutsLive || String(row.account_id).startsWith('acct_mock_')) return { connected: true, ready: row.ready, mock: true }
  const acct = await stripe.accounts.retrieve(row.account_id)
  const ready = !!acct.payouts_enabled
  if (ready !== row.ready) await admin.from('payout_accounts').update({ ready, updated_at: new Date().toISOString() }).eq('user_id', userId)
  return { connected: true, ready, details: !!acct.details_submitted }
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
 * sent yet — and only then is the transfer made, so two runs at once cannot both send the same
 * lines; if the transfer fails the claim is lifted and the lines are exactly as they were.
 */
export async function sendDue(userId: string) {
  const now = new Date().toISOString()
  const { data: lines } = await admin.from('payout_lines').select('id, amount, currency')
    .eq('user_id', userId).is('paid_at', null).lte('payable_at', now)
  const rows = lines ?? []
  const amount = rows.reduce((n, l) => n + (Number(l.amount) || 0), 0)
  if (!rows.length || amount <= 0) return { sent: 0, amount, reason: rows.length ? 'a reversal stands against what is earned next' : 'nothing is payable' }
  const { data: acct } = await admin.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!acct || !acct.ready) return { sent: 0, amount, reason: acct ? 'the account is not ready' : 'no account connected' }
  const currency = rows[0].currency ?? 'usd'
  const ref = (payoutsLive ? 'po_' : 'po_mock_') + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const ids = rows.map((l) => l.id)

  /* the claim */
  const { error: claimErr } = await admin.from('payout_lines').update({ payout_ref: ref }).in('id', ids).is('paid_at', null)
  if (claimErr) return { sent: 0, amount, reason: 'the ledger refused the claim: ' + claimErr.message }

  try {
    if (payoutsLive) {
      await stripe.transfers.create({
        amount, currency, destination: acct.account_id,
        metadata: { user_id: userId, lines: String(ids.length), ref },
      }, { idempotencyKey: ref })
    }
    await admin.from('payout_lines').update({ paid_at: new Date().toISOString() }).in('id', ids)
    return { sent: ids.length, amount, currency, ref, mock: !payoutsLive }
  } catch (e) {
    /* the claim is lifted: nothing was sent, and the next run must be free to try again */
    await admin.from('payout_lines').update({ payout_ref: null }).in('id', ids).is('paid_at', null)
    return { sent: 0, amount, reason: 'the transfer was refused: ' + String((e as Error).message ?? e) }
  }
}
