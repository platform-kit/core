/*
 * THE LEDGER AGAINST THE STACK. The pure arithmetic is build/payouts.test.mjs; what is here is the
 * part a pure function cannot tell you:
 *
 *   THE SWEEP RUNS TWICE AND PAYS ONCE. A cron, a hand and a retry after a fault all call the same
 *   function, so "already done" has to be the database's answer rather than something a caller
 *   remembers. The unique index is what makes it safe to run it whenever.
 *
 *   A CALL THAT HAPPENED EARNS; ONE NOBODY CAME TO DOES NOT. And it is the PROVIDER's absence that
 *   costs them — a client who missed the hour still had it held for them.
 *
 *   A REFUND INSIDE THE WINDOW NEVER BECOMES PAYABLE; AFTER IT, IT REVERSES. Two different
 *   behaviours from one call, and which one you get depends on whether the money has gone.
 *
 *   A PROVIDER READS THEIR OWN LINES AND NOBODY ELSE'S, and can write none of it — not the rule that
 *   says what they earn, not the line that says they earned it.
 *
 * Everything it makes is removed at the end. Skipped with a note when the stack is down.
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { balanceOf } from '../src/lib/payouts.js'

const note = (m) => console.log('payouts-db: ' + m)
if (process.env.PAYOUTS_TEST === '0') { note('skipped (PAYOUTS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

console.log('\nPAYOUTS · THE LEDGER\n')

/* A THROWAWAY PROVIDER AND A THROWAWAY CLIENT. The seeded accounts are shared with every other
   suite, and a payout line left on one would be somebody else's confusing failure. */
const tag = 't' + Math.random().toString(36).slice(2, 8)
const made = { users: [], rules: [], bookings: [], purchases: [], credits: [], accounts: [] }
const mkUser = async (email) => {
  const { data, error } = await service.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  if (error) throw new Error(email + ': ' + error.message)
  made.users.push(data.user.id)
  return data.user.id
}
const signIn = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return sb
}
const iso = (ms) => new Date(ms).toISOString()
const now = Date.now()

try {
  const providerId = await mkUser(tag + '-provider@example.com')
  const clientId = await mkUser(tag + '-client@example.com')
  await service.from('profiles').update({ roles: ['provider'] }).eq('id', providerId)

  /* --- what the site's policy says the delay is --- */
  const { data: delay } = await service.rpc('payout_delay')
  ok('the delay is the policy\'s, in minutes', Number(delay) > 0, String(delay))

  /* --- the rules: a monthly retainer, a share of every call, a flat amount per call --- */
  const rule = async (r) => {
    const { data, error } = await service.from('payout_rules').insert({ user_id: providerId, ...r }).select('id').single()
    if (error) throw new Error('rule: ' + error.message)
    made.rules.push(data.id)
    return data.id
  }
  const shareRule = await rule({ trigger: 'booking', booking_type: tag + '-call', amount_kind: 'share', amount: 1250 })
  const flatRule = await rule({ trigger: 'booking', booking_type: tag + '-call', amount_kind: 'fixed', amount: 5000 })
  await rule({ trigger: 'monthly', amount_kind: 'fixed', amount: 40000 })

  /* THE DATABASE REFUSES A SHARE OF A PERIOD TOO. The pure rule refuses it in the form; the check
     constraint refuses it however the row arrives, which is the one that matters. */
  const badShare = await service.from('payout_rules').insert({ user_id: providerId, trigger: 'monthly', amount_kind: 'share', amount: 1250 })
  ok('the database refuses a share of a month', !!badShare.error)
  const badBooking = await service.from('payout_rules').insert({ user_id: providerId, trigger: 'booking', amount_kind: 'fixed', amount: 100 })
  ok('the database refuses a booking rule with no type', !!badBooking.error)
  const badAmount = await service.from('payout_rules').insert({ user_id: providerId, trigger: 'monthly', amount_kind: 'fixed', amount: 0 })
  ok('the database refuses an amount of nothing', !!badAmount.error)

  /* --- a call, and the payment it was for ---
     A PAID SESSION IS A PURCHASE, A CREDIT AND A BOOKING THAT SPENT IT, which is how the site really
     does it; the sweep follows that chain rather than guessing which payment a call belonged to. */
  const purchase = async (amount, at) => {
    const session = 'cs_' + tag + '_' + made.purchases.length
    const { data, error } = await service.from('purchases')
      .insert({ user_id: clientId, sku: tag + '-session', key: tag.slice(0, 8), status: 'paid', amount_total: amount, currency: 'usd', created_at: at, stripe_checkout_session_id: session })
      .select('id').single()
    if (error) throw new Error('purchase: ' + error.message)
    made.purchases.push(data.id)
    const credit = await service.from('entitlements')
      .insert({ user_id: clientId, kind: 'product', key: 'session:' + tag, source: 'purchase', source_id: session + ':0' })
      .select('id').single()
    if (credit.error) throw new Error('credit: ' + credit.error.message)
    made.credits.push(credit.data.id)
    return { id: data.id, credit: credit.data.id }
  }
  const booking = async (uid, fields) => {
    const { error } = await service.from('bookings').insert({
      uid, user_id: clientId, provider_id: providerId, type: tag + '-call', event: tag + '-call',
      title: 'A call', status: 'ended', created_at: iso(now - 3 * 864e5),
      start_at: iso(now - 2 * 864e5), end_at: iso(now - 2 * 864e5 + 36e5), ...fields,
    })
    if (error) throw new Error('booking: ' + error.message)
    made.bookings.push(uid)
  }
  const paidAt = iso(now - 3 * 864e5)
  const pay1 = await purchase(8000, paidAt)
  const p1 = pay1.id
  await booking(tag + '-1', { credit_id: pay1.credit })

  const linesOf = async () => (await service.from('payout_lines').select('*').eq('user_id', providerId)).data || []

  /* --- the sweep --- */
  const { data: swept, error: sweepErr } = await service.rpc('payouts_sweep')
  ok('the sweep ran', !sweepErr, sweepErr && sweepErr.message)
  ok('one line per booking rule, and none for the retainer', Number(swept) === 2, String(swept))
  let lines = await linesOf()
  ok('the share is a share of what was collected', lines.some((l) => l.rule_id === shareRule && l.amount === 1000))
  ok('the flat amount is flat', lines.some((l) => l.rule_id === flatRule && l.amount === 5000))
  ok('each line says which payment it came from', lines.every((l) => l.purchase_id === p1))
  ok('each line says what it was for, in words', lines.every((l) => /A call/.test(l.about || '')))
  ok('each line is earned when the call ended', lines.every((l) => Date.parse(l.earned_at) < now))
  ok('and payable the delay after the money came', lines.every((l) => Math.abs(Date.parse(l.payable_at) - (Date.parse(paidAt) + Number(delay) * 60000)) < 2000))

  /* RUN IT AGAIN. This is the claim the whole design rests on. */
  const { data: again } = await service.rpc('payouts_sweep')
  ok('a second sweep writes nothing', Number(again) === 0, String(again))
  ok('and there are still two lines', (await linesOf()).length === 2)

  /* --- a call nobody came to --- */
  await booking(tag + '-noshow', { no_show: true, no_show_by: providerId })
  await service.rpc('payouts_sweep')
  ok('a call the provider missed earns nothing', (await linesOf()).length === 2)
  await booking(tag + '-clientmissed', { no_show: true, no_show_by: clientId })
  await service.rpc('payouts_sweep')
  ok('a call the client missed earns, because the hour was held', (await linesOf()).length === 4)
  /* and it came with no payment, so the share of it is a line of nothing rather than no line at all */
  const free = (await linesOf()).filter((l) => l.booking_uid === tag + '-clientmissed')
  ok('a call with no payment behind it still earns its flat rule', free.some((l) => l.amount === 5000))
  ok('and a share of nothing is a line of nothing', free.some((l) => l.amount === 0 && l.purchase_id === null))
  /* and a call that has not happened yet earns nothing */
  await booking(tag + '-future', { start_at: iso(now + 864e5), end_at: iso(now + 864e5 + 36e5), status: 'accepted' })
  await service.rpc('payouts_sweep')
  ok('a call still to come earns nothing', (await linesOf()).length === 4)
  await booking(tag + '-cancelled', { status: 'cancelled' })
  await service.rpc('payouts_sweep')
  ok('a cancelled call earns nothing', (await linesOf()).length === 4)

  /* --- the balance, read three ways and agreeing --- */
  const { data: bal } = await service.rpc('payout_balance', { p_user: providerId })
  const mine = balanceOf(await linesOf())
  ok('the database and the pure module agree on what is earned', Number(bal.earned) === mine.earned, bal.earned + ' vs ' + mine.earned)
  ok('nothing is payable inside the window', Number(bal.payable) === 0 && Number(bal.waiting) === mine.earned)
  ok('and nothing has been sent', Number(bal.sent) === 0)
  ok('it says whether they can be paid at all', bal.connected === false)

  /* --- a refund inside the window --- */
  const { data: reversedIn } = await service.rpc('payouts_reverse', { p_purchase: p1, p_refunded: 4000 })
  ok('a refund inside the window touches the lines it earned', Number(reversedIn) === 2, String(reversedIn))
  lines = await linesOf()
  ok('no reversing line is written', lines.filter((l) => l.reverses).length === 0)
  ok('they simply never become payable', lines.filter((l) => l.purchase_id === p1).every((l) => Date.parse(l.payable_at) > now + 100 * 365 * 864e5 || l.payable_at === 'infinity'))
  const { data: bal2 } = await service.rpc('payout_balance', { p_user: providerId })
  ok('so neither payable nor waiting counts them', Number(bal2.payable) === 0 && Number(bal2.waiting) === 5000, JSON.stringify(bal2))
  /* AND NEITHER DOES EARNED: the money went back, so a figure counted as earned and then nowhere
     else would be a figure with no home */
  ok('and they are not earned either — the money went back', Number(bal2.earned) === 5000, JSON.stringify(bal2))

  /* --- a refund after the window, on money already sent --- */
  const pay2 = await purchase(8000, paidAt)
  const p2 = pay2.id
  await booking(tag + '-2', { credit_id: pay2.credit })
  await service.rpc('payouts_sweep')
  const late = (await linesOf()).filter((l) => l.purchase_id === p2)
  ok('the second call earned two lines', late.length === 2)
  /* release them and send them, as a payout run would */
  await service.from('payout_lines').update({ payable_at: iso(now - 864e5), paid_at: iso(now - 36e5), payout_ref: 'po_' + tag })
    .in('id', late.map((l) => l.id))
  const { data: reversedOut } = await service.rpc('payouts_reverse', { p_purchase: p2, p_refunded: 4000 })
  ok('a refund after it writes a reversing line for each', Number(reversedOut) === 2, String(reversedOut))
  const rev = (await linesOf()).filter((l) => l.reverses)
  ok('half the payment back is half of each amount back', rev.map((l) => l.amount).sort((a, b) => a - b).join() === '-2500,-500', rev.map((l) => l.amount).join())
  ok('a reversal points at what it undoes', rev.every((l) => late.some((o) => o.id === l.reverses)))
  ok('a reversal is payable at once, so it stands against the next thing earned', rev.every((l) => Date.parse(l.payable_at) <= Date.now() + 2000))
  ok('and says so in words', rev.every((l) => /^Reversed/.test(l.about)))
  ok('the line it reverses is left exactly as it was', (await linesOf()).filter((l) => late.some((o) => o.id === l.id)).every((l) => l.paid_at && l.amount > 0))
  /* reversing twice does not reverse twice */
  const { data: twice } = await service.rpc('payouts_reverse', { p_purchase: p2, p_refunded: 4000 })
  ok('reversing the same refund again writes nothing', Number(twice) === 0, String(twice))

  /* --- a refund that landed before the sweep ever ran --- */
  const pay3 = await purchase(8000, paidAt)
  await service.from('purchases').update({ status: 'refunded' }).eq('id', pay3.id)
  await booking(tag + '-3', { credit_id: pay3.credit })
  const before = (await linesOf()).length
  await service.rpc('payouts_sweep')
  ok('a call whose payment was already given back earns nothing at all', (await linesOf()).length === before)

  /* --- who may see and who may write --- */
  const asProvider = await signIn(tag + '-provider@example.com')
  const asClient = await signIn(tag + '-client@example.com')
  const seen = await asProvider.from('payout_lines').select('id')
  ok('a provider reads their own lines', (seen.data || []).length > 0)
  const strangerSees = await asClient.from('payout_lines').select('id')
  ok('a reader reads none of them', (strangerSees.data || []).length === 0)
  const wrote = await asProvider.from('payout_lines').insert({ user_id: providerId, amount: 999999, about: 'a gift to myself', payable_at: iso(now) })
  ok('a provider cannot write themselves a line', !!wrote.error)
  const madeRule = await asProvider.from('payout_rules').insert({ user_id: providerId, trigger: 'monthly', amount_kind: 'fixed', amount: 999999 })
  ok('nor a rule saying what they earn', !!madeRule.error)
  const theirBalance = await asProvider.rpc('payout_balance')
  ok('their own balance is theirs to read', theirBalance.data && Number(theirBalance.data.earned) !== 0)
  const nosy = await asClient.rpc('payout_balance', { p_user: providerId })
  ok('and nobody else\'s', nosy.data === null, JSON.stringify(nosy.data))
  /* --- the door, where the functions are served (npm run dev serves them) ---
     With no Stripe keys — or PAYOUTS_MOCK=1 — the site still earns, still keeps its ledger and says
     which of the two it is doing. That is the whole claim worth testing here: nothing is silently
     skipped, and nobody can send themselves anything. */
  let served = false
  try { served = (await fetch(url + '/functions/v1/payouts', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ }
  if (!served) console.log('  (the payouts function is not served — npm run dev serves it)')
  else {
    const call = async (sb, body) => {
      const { data } = await sb.auth.getSession()
      const r = await fetch(url + '/functions/v1/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify(body),
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const asAdmin = await signIn('admin@example.com')

    const mine = await call(asProvider, { action: 'status' })
    ok('a provider reads their own standing', mine.status === 200 && mine.body.balance && Number(mine.body.balance.earned) !== 0, JSON.stringify(mine.body && mine.body.balance))
    ok('with the lines that made it', Array.isArray(mine.body.lines) && mine.body.lines.length > 0)
    ok('and the site says which arrangement it pays under', ['managed', 'own'].includes(mine.body.connect))
    ok('and whether money can actually move at all', typeof mine.body.live === 'boolean')

    const nosyStatus = await call(asClient, { action: 'status', user: providerId })
    ok('a reader asking about somebody else is refused, not quietly answered about themselves', nosyStatus.status === 403)
    const nosyDue = await call(asClient, { action: 'due' })
    ok('nor who is owed anything', nosyDue.status === 403)
    const nosySend = await call(asProvider, { action: 'send', user: providerId })
    ok('and a provider cannot pay themselves', nosySend.status === 403)

    /* connecting: the mock finishes in one step so every surface can be walked with no account */
    const connected = await call(asProvider, { action: 'connect' })
    ok('connecting an account answers either a link or the mock', connected.status === 200 && (connected.body.url || connected.body.mock))
    const acctRow = await service.from('payout_accounts').select('*').eq('user_id', providerId).maybeSingle()
    ok('and the site keeps the processor\'s reference and nothing else', !!acctRow.data && !!acctRow.data.account_id)
    ok('no card and no bank detail anywhere in the row', !Object.keys(acctRow.data).some((k) => /card|bank|iban|routing|account_number|sort/.test(k)))
    made.accounts.push(providerId)

    /* --- who is due, and sending it --- */
    const due = await call(asAdmin, { action: 'due' })
    ok('an administrator sees who is owed something', due.status === 200 && Array.isArray(due.body.due))
    /* AT THIS POINT WHAT IS PAYABLE IS THE REVERSAL and nothing else — the earnings are either
       inside the window or already sent. So the person appears on the list owed less than nothing,
       is not sendable, and the reason is said in words rather than left to be inferred from a minus. */
    const owing = (due.body.due || []).find((d) => d.user_id === providerId)
    ok('a reversal with nothing to set against it puts them on the list owed less than nothing', owing && owing.amount < 0, JSON.stringify(owing))
    ok('nothing is sent for it', owing && owing.sendable === false)
    ok('and the reason is a sentence, not a minus sign', owing && /stands against what is earned next/.test(owing.why || ''))

    /* release what the second call earned, and send it */
    await service.from('payout_lines').update({ payable_at: iso(now - 864e5), paid_at: null, payout_ref: null })
      .eq('user_id', providerId).is('reverses', null).gt('amount', 0).lt('payable_at', iso(now + 1e12))
    const due2 = await call(asAdmin, { action: 'due' })
    const row = (due2.body.due || []).find((d) => d.user_id === providerId)
    ok('once the delay has passed they are on the list', !!row, JSON.stringify(due2.body.due))
    ok('with what stands in the way said in words, or nothing', row && (row.why === null || typeof row.why === 'string'))
    const sent = await call(asAdmin, { action: 'send', user: providerId })
    ok('sending answers what went', sent.status === 200 && sent.body.sent > 0, JSON.stringify(sent.body))
    const after = await service.from('payout_lines').select('paid_at, payout_ref').eq('user_id', providerId).not('payout_ref', 'is', null)
    ok('and every line it sent is stamped with when and under what reference', (after.data || []).length > 0 && after.data.every((l) => l.paid_at && l.payout_ref))
    const twiceSent = await call(asAdmin, { action: 'send', user: providerId })
    ok('sending again sends nothing, because nothing is payable', twiceSent.body.sent === 0, JSON.stringify(twiceSent.body))

    /* and the sweep by hand is the same sweep */
    const swept2 = await call(asAdmin, { action: 'sweep' })
    ok('the sweep by hand is the sweep', swept2.status === 200 && typeof swept2.body.written === 'number')
  }

} catch (e) {
  fail++
  console.log('  FAIL  ' + e.message)
} finally {
  await service.from('payout_lines').delete().in('user_id', made.users)
  await service.from('payout_rules').delete().in('id', made.rules)
  await service.from('bookings').delete().in('uid', made.bookings)
  await service.from('purchases').delete().in('id', made.purchases)
  await service.from('entitlements').delete().in('id', made.credits)
  await service.from('payout_accounts').delete().in('user_id', made.accounts)
  for (const id of made.users) await service.auth.admin.deleteUser(id).catch(() => {})
}

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
