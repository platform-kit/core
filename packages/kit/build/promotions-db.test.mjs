/*
 * WHAT A DISCOUNT HAS COST SO FAR — against the real database, because the only thing that makes
 * a budget a budget is that two checkouts finishing at the same instant cannot both be the last
 * one under the limit. That is a claim about concurrency and cannot be tested over plain objects.
 *
 * A budget written in a file and counted nowhere is a decoration: redeploy the repository and the
 * half-spent campaign comes back full. So the limit is the declaration and the spend is a row.
 *
 * Skipped with a note naming what it did not cover when the stack is down (PROMO_TEST=0 too).
 *
 *   node packages/kit/build/promotions-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('promotions-db: ' + m)
if (process.env.PROMO_TEST === '0') { note('skipped (PROMO_TEST=0) — nothing about budgets or overspending was covered'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env; nothing about budgets or overspending was covered'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up; nothing about budgets or overspending was covered'); leave(0) }

const db = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n    ')) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const NAME = 'probe-promo'
const clear = async () => { await db.from('promotion_uses').delete().eq('promotion', NAME); await db.from('promotion_usage').delete().eq('promotion', NAME) }
const take = (kind, limit, amount) => db.rpc('promotion_take', { p_promotion: NAME, p_kind: kind, p_limit: limit, p_amount: amount, p_about: null, p_user: null })
const used = async () => (await db.from('promotion_usage').select('used').eq('promotion', NAME).maybeSingle()).data?.used ?? null

console.log('\nWHAT A DISCOUNT HAS COST\n')

await ok('a promotion with no limit is always allowed, and is still recorded', async () => {
  await clear()
  const { data } = await db.rpc('promotion_take', { p_promotion: NAME, p_kind: 'usage', p_limit: null, p_amount: 500, p_about: null, p_user: null })
  eq(data, true)
  eq((await db.from('promotion_uses').select('id').eq('promotion', NAME)).data.length, 1, 'what it cost is recorded even where nothing caps it')
  eq(await used(), null, 'and no budget row is invented for a promotion that has no budget')
})

await ok('a USAGE budget counts the times, and the one past the limit is refused', async () => {
  await clear()
  for (let i = 0; i < 3; i++) eq((await take('usage', 3, 0)).data, true, `use ${i + 1} of 3`)
  eq((await take('usage', 3, 0)).data, false, 'the fourth')
  eq(await used(), 3)
})

await ok('a SPEND budget counts the money, and refuses the one that would overspend', async () => {
  await clear()
  eq((await take('spend', 1000, 600)).data, true)
  eq((await take('spend', 1000, 300)).data, true, '900 of 1000')
  eq((await take('spend', 1000, 200)).data, false, '1100 would be over, so it is refused whole')
  eq(await used(), 900, 'and a refused take spends nothing')
})

/*
 * THE ONE THAT MATTERS. Ten checkouts, three uses left. A read-then-write implementation lets
 * them all through and the shop has given away four discounts it said it would not.
 */
await ok('ten checkouts racing for three uses: exactly three win', async () => {
  await clear()
  const all = await Promise.all(Array.from({ length: 10 }, () => take('usage', 3, 0)))
  eq(all.filter((r) => r.data === true).length, 3)
  eq(await used(), 3, 'and the count is three, never four')
})

await ok('and racing for a spend budget cannot overspend it either', async () => {
  await clear()
  const all = await Promise.all(Array.from({ length: 10 }, () => take('spend', 1000, 300)))
  const won = all.filter((r) => r.data === true).length
  eq(won, 3, 'three at 300 is 900; a fourth would be 1200')
  eq(await used(), 900)
})

await ok('a refund gives the budget back', async () => {
  await clear()
  await take('spend', 1000, 600)
  await db.rpc('promotion_give', { p_promotion: NAME, p_kind: 'spend', p_amount: 600 })
  eq(await used(), 0)
  eq((await take('spend', 1000, 1000)).data, true, 'and the whole budget is available again')
})

await ok('giving back more than was taken floors at nothing rather than going negative', async () => {
  await clear()
  await take('usage', 5, 0)
  for (let i = 0; i < 5; i++) await db.rpc('promotion_give', { p_promotion: NAME, p_kind: 'usage', p_amount: 0 })
  eq(await used(), 0)
})

await ok('a shopper may read what is left and may never write it', async () => {
  const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '', { auth: { persistSession: false } })
  await clear(); await take('usage', 5, 0)
  const { data } = await anon.from('promotion_usage').select('used').eq('promotion', NAME)
  if (!Array.isArray(data)) throw new Error('a page could not ask whether a discount is still going')
  await anon.from('promotion_usage').update({ used: 0 }).eq('promotion', NAME)
  eq(await used(), 1, 'a reader cannot reset a budget')
  const { error } = await anon.rpc('promotion_take', { p_promotion: NAME, p_kind: 'usage', p_limit: 99, p_amount: 0, p_about: null, p_user: null })
  if (!error) throw new Error('a reader was able to spend a budget')
})

/*
 * AN ABANDONED CHECKOUT GIVES THE BUDGET BACK.
 *
 * The budget has to be taken BEFORE the session exists — or two people could both be the last
 * one under the limit while Stripe is still thinking — which means an abandoned checkout has
 * spent budget on a sale that never happened. Without a release, a campaign with a hundred uses
 * is exhausted by a hundred people who changed their minds.
 *
 * This is the same shape as the stock hold, and it was missed the same way: the taking was
 * written and the giving back was not.
 */
await ok('a checkout that died gives its budget back, and the next buyer can have it', async () => {
  await clear()
  for (let i = 0; i < 3; i++) await take('usage', 3, 0)
  eq((await take('usage', 3, 0)).data, false, 'spent')
  /* the webhook, on checkout.session.expired, for one of them */
  await db.rpc('promotion_give', { p_promotion: NAME, p_kind: 'usage', p_amount: 0 })
  eq((await take('usage', 3, 0)).data, true, 'the abandoned one is available again')
  eq(await used(), 3)
})

await ok('and a spend budget gives back exactly what that checkout held', async () => {
  await clear()
  await take('spend', 1000, 400)
  await take('spend', 1000, 400)
  eq((await take('spend', 1000, 400)).data, false, '1200 would be over')
  await db.rpc('promotion_give', { p_promotion: NAME, p_kind: 'spend', p_amount: 400 })
  eq(await used(), 400)
  eq((await take('spend', 1000, 600)).data, true, 'and 600 now fits')
})
await clear()
console.log(`\npromotions-db: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
