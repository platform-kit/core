/*
 * WHAT STOPS A PAYMENT BEING COUNTED TWICE — the database half, against the running stack.
 *
 * `build/ledger.test.mjs` pins what a payment DECIDES: who paid, which offer a line is, and that
 * every grant's source id is a function of the payment and nothing else. That is half the promise.
 * The other half is the database actually refusing the duplicate — and no amount of care in the
 * decisions helps if the constraint that enforces them is not there.
 *
 * It matters because a payment arrives more than once as a matter of course: Stripe retries its
 * events, and the browser's own `confirm-checkout` writes the same session the webhook does, on
 * purpose, so that what somebody paid for is theirs on landing. Both writers are correct. What
 * makes them safe is that the second one cannot add anything.
 *
 * The failures this guards are specific and expensive in opposite directions. Too LOOSE and one
 * payment becomes two purchases, or a person is granted the same thing twice. Too TIGHT and three
 * sessions bought in one go collapse into one credit — somebody paid for three hours of
 * somebody's time and got one, and nothing anywhere says so.
 *
 * No Stripe, live or mocked: these are the constraints, asked directly.
 *
 *   node packages/kit/build/money-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nWHAT STOPS A PAYMENT BEING COUNTED TWICE\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The constraints behind a repeated payment are NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')
const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: who } = await admin.from('profiles').select('id').eq('email', 'member@example.com').maybeSingle()
if (!who) skip('the seed\'s member is not there (npx supabase db reset)')

const SESSION = 'cs_probe_' + Date.now()
const made = []
const cleanup = async () => {
  await admin.from('entitlements').delete().like('source_id', 'cs_probe_%')
  await admin.from('purchases').delete().like('stripe_checkout_session_id', 'cs_probe_%')
}
await cleanup()

try {
  /*
   * ─── A PURCHASE IS A LINE, AND A LINE IS WRITTEN ONCE ───
   *
   * This used to say "a purchase is the SESSION", and the table agreed: unique on the session
   * alone. But the ledger upserts onto that constraint inside a loop over the session's lines,
   * so a basket holding two things wrote ONE row — the last line, with the whole basket total
   * beside it. The identity of a purchase is the line, and a line is identified by its price
   * (Stripe merges a repeated price into one line with a quantity).
   *
   * NULLS NOT DISTINCT matters here and is why the first version of this was wrong: Postgres
   * counts two NULLs as different in a unique index, so a row with no price_id — which is
   * exactly the row this test writes — could be written twice and the payment became two
   * purchases. The ledger always has a price, but a constraint that only holds on the paths we
   * happen to take is not a constraint.
   */
  {
    const row = { user_id: who.id, stripe_checkout_session_id: SESSION, key: 'probe-offer', sku: 'probe-offer', status: 'paid', amount_total: 1000, currency: 'usd' }
    const a = await admin.from('purchases').insert(row)
    ok('a purchase is written', !a.error, a.error?.message)

    /* the SECOND writer — the webhook arriving after confirm-checkout, or a Stripe retry */
    const b = await admin.from('purchases').insert(row)
    ok('and the same line cannot be written a second time, even with no price on it', !!b.error, 'the payment became two purchases')

    /* which is why the write goes through `purchase_write`: both writers may run, in either
       order and twice, and the row is one. It is a function and not an upsert because the
       index is partial and no column list can name a partial index. */
    const c = await admin.rpc('purchase_write', { p: row })
    ok('the one door both writers use is safe to run twice', !c.error, c.error?.message)
    const { count } = await admin.from('purchases').select('id', { count: 'exact', head: true }).eq('stripe_checkout_session_id', SESSION)
    ok('and leaves exactly one purchase', count === 1, `${count} purchases for one line`)

    /* and a basket of two things is TWO rows, which the old constraint made impossible */
    const second = { ...row, price_id: 'price_probe_b', sku: 'probe-offer-b', key: 'probe-offer-b', amount_total: 2500 }
    const d = await admin.rpc('purchase_write', { p: second })
    ok('a second line of the same payment is its own row', !d.error, d.error?.message)
    const { count: two } = await admin.from('purchases').select('id', { count: 'exact', head: true }).eq('stripe_checkout_session_id', SESSION)
    ok('so a basket of two things is two purchases, not one', two === 2, `${two} rows for a two-line order`)

    /* ...and each still writes once */
    const e = await admin.rpc('purchase_write', { p: { ...second, amount_total: 9999 } })
    ok('and writing the second line again updates it rather than adding one', !e.error, e.error?.message)
    const { count: still } = await admin.from('purchases').select('id', { count: 'exact', head: true }).eq('stripe_checkout_session_id', SESSION)
    ok('so the payment is still two purchases, not three', still === 2, `${still} rows`)
    const { data: upd } = await admin.from('purchases').select('amount_total').eq('stripe_checkout_session_id', SESSION).eq('price_id', 'price_probe_b').maybeSingle()
    ok('and the second writer\'s figures won', upd?.amount_total === 9999, String(upd?.amount_total))
  }

  /* ─── a grant is the payment plus what it is for, and never doubles ─── */
  {
    const grant = { user_id: who.id, kind: 'class', key: 'paid', source: 'purchase', source_id: SESSION }
    await admin.from('entitlements').insert(grant)
    const again = await admin.from('entitlements').insert(grant)
    ok('the same grant from the same payment is refused', !!again.error, 'somebody was granted the same thing twice')
    const up = await admin.from('entitlements').upsert(grant, { onConflict: 'user_id,kind,key,source_id' })
    ok('and the upsert both writers use is accepted', !up.error, up.error?.message)
    const { count } = await admin.from('entitlements').select('id', { count: 'exact', head: true }).eq('source_id', SESSION).eq('key', 'paid')
    ok('leaving one grant, not two', count === 1, `${count} grants`)
  }

  /*
   * ─── THREE BOUGHT IS THREE OWED ───
   *
   * This is the case the source ids exist for. A session, an offering or a form is one credit PER
   * UNIT, and each carries `<session>:<n>` — because if they all shared the session id, the
   * constraint above would silently fold three into one. The person paid for three and would hold
   * one, and no error would be raised anywhere: the ledger would have done exactly what it was
   * told, and the database exactly what it was told, and the buyer would simply be short.
   */
  {
    const key = 'session:probe-offer'
    const rows = [0, 1, 2].map((i) => ({ user_id: who.id, kind: 'product', key, source: 'purchase', source_id: `${SESSION}:${i}` }))
    const r = await admin.from('entitlements').insert(rows)
    ok('three credits from one payment are three rows', !r.error, r.error?.message)
    const { count } = await admin.from('entitlements').select('id', { count: 'exact', head: true }).eq('key', key).like('source_id', SESSION + ':%')
    ok('and all three are there', count === 3, `${count} of 3 — somebody paid for three and holds ${count}`)

    /* and the retry of that same payment adds nothing */
    await admin.from('entitlements').upsert(rows, { onConflict: 'user_id,kind,key,source_id' })
    const { count: after } = await admin.from('entitlements').select('id', { count: 'exact', head: true }).eq('key', key).like('source_id', SESSION + ':%')
    ok('a retry of the same payment still leaves three', after === 3, `${after} after the retry`)

    /* the failure the per-unit id prevents, shown: one shared id folds them into one */
    /* one at a time, the way the ledger writes them — three in one statement is refused outright
       by Postgres ("cannot affect row a second time"), which would prove something else entirely */
    const shared = { user_id: who.id, kind: 'product', key: 'session:probe-shared', source: 'purchase', source_id: SESSION }
    for (let i = 0; i < 3; i++) await admin.from('entitlements').upsert(shared, { onConflict: 'user_id,kind,key,source_id' })
    const { count: folded } = await admin.from('entitlements').select('id', { count: 'exact', head: true }).eq('key', 'session:probe-shared')
    ok('where a shared source id WOULD fold three into one', folded === 1, `${folded} — if this is not 1 the constraint is not doing what the ids assume`)
  }

  /* ─── a grant for a different thing from the same payment is its own row ─── */
  {
    const book = { user_id: who.id, kind: 'product', key: 'the-kybalion', source: 'purchase', source_id: SESSION }
    const r = await admin.from('entitlements').upsert(book, { onConflict: 'user_id,kind,key,source_id' })
    ok('one payment may grant several different things', !r.error, r.error?.message)
    /* counted by KEY, not by source id: the shared-id demonstration above also sits on this
       session, and a bare count of the session would quietly include it */
    const { data: rows } = await admin.from('entitlements').select('key').eq('source_id', SESSION)
    const keys = new Set((rows || []).map((r) => r.key))
    ok('each as its own row', keys.has('paid') && keys.has('the-kybalion'), [...keys].join(', '))
  }
} finally {
  await cleanup()
  void made
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
