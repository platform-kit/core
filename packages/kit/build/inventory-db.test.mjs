/*
 * WHAT IS LEFT, against the real database — because every claim here is a claim about CONCURRENCY,
 * and concurrency cannot be tested over plain objects.
 *
 * The decrement being "in the same statement as the sale" is either true of the SQL or it is not,
 * and the only thing that can tell you is two connections racing for the same last unit. A test
 * that called the function twice in sequence would pass against an implementation that reads and
 * then writes — which is exactly the implementation that oversells.
 *
 * Skipped with a note naming what it did not cover when the stack is down (INVENTORY_TEST=0 too).
 *
 *   node packages/kit/build/inventory-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('inventory-db: ' + m)
if (process.env.INVENTORY_TEST === '0') { note('skipped (INVENTORY_TEST=0) — nothing about stock, reservations or overselling was covered'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env; nothing about stock, reservations or overselling was covered'); process.exit(0) }
const key = serviceKey()
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up; nothing about stock, reservations or overselling was covered'); process.exit(0) }

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n    ')) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const SKU = 'probe-inventory'
const reset = async (stocked, variant = '') => {
  await db.from('inventory_movements').delete().eq('sku', SKU)
  await db.from('inventory').delete().eq('sku', SKU)
  await db.from('inventory').insert({ sku: SKU, variant, stocked, reserved: 0 })
}
const row = async (variant = '') => (await db.from('inventory').select('*').eq('sku', SKU).eq('variant', variant).maybeSingle()).data
const take = (qty, reason, about, variant = '', backorder = false) => db.rpc('inventory_take', { p_sku: SKU, p_variant: variant, p_qty: qty, p_reason: reason, p_about: about ?? null, p_backorder: backorder })
const give = (qty, reason, about, variant = '') => db.rpc('inventory_give', { p_sku: SKU, p_variant: variant, p_qty: qty, p_reason: reason, p_about: about ?? null })
const moves = async () => (await db.from('inventory_movements').select('*').eq('sku', SKU).order('at')).data || []

console.log('\nWHAT IS LEFT\n')

await ok('available is stocked less reserved, and is never a column', async () => {
  await reset(10)
  await take(3, 'reserved', 'cs_a')
  const r = await row()
  eq(r.stocked, 10, 'a reservation does not lower the stock')
  eq(r.reserved, 3)
  eq(Object.prototype.hasOwnProperty.call(r, 'available'), false, 'there is no available column, and there must never be one')
  const { data } = await db.rpc('inventory_available', { p_sku: SKU, p_variant: '' })
  eq(data, 7, 'available is derived')
})

await ok('a sale lowers the stock and releases the reservation it was holding, in one go', async () => {
  await reset(10)
  await take(2, 'reserved', 'cs_b')
  await take(2, 'sold', 'cs_b')
  const r = await row()
  eq(r.stocked, 8); eq(r.reserved, 0, 'the units it was holding are no longer held as well as sold')
})

/*
 * THE ONE THAT MATTERS. Two connections, one unit, both asking at the same instant. A read-then-
 * write implementation lets both through and the shop owes somebody an apology; the condition
 * being inside the UPDATE means the second matches no row.
 */
await ok('two sessions racing for the last unit: exactly one wins', async () => {
  await reset(1)
  const [a, b] = await Promise.all([take(1, 'sold', 'cs_x'), take(1, 'sold', 'cs_y')])
  const won = [a.data, b.data].filter((x) => x === true).length
  eq(won, 1, 'exactly one of the two sales succeeded')
  const r = await row()
  eq(r.stocked, 0, 'and the stock is zero, never minus one')
})

await ok('ten at once over four units: four succeed and six are refused', async () => {
  await reset(4)
  const all = await Promise.all(Array.from({ length: 10 }, (_, i) => take(1, 'sold', 'cs_' + i)))
  eq(all.filter((x) => x.data === true).length, 4)
  eq((await row()).stocked, 0)
})

await ok('a reservation may not take more than is available', async () => {
  await reset(3)
  await take(3, 'reserved', 'cs_c')
  const { data } = await take(1, 'reserved', 'cs_d')
  eq(data, false, 'the fourth reservation is refused — three are already held')
  eq((await row()).reserved, 3)
})

await ok('a released reservation gives the units back and says why', async () => {
  await reset(5)
  await take(2, 'reserved', 'cs_e')
  await give(2, 'released', 'cs_e')
  const r = await row()
  eq(r.reserved, 0); eq(r.stocked, 5, 'nothing was sold, so nothing left the stock')
  const m = (await moves()).filter((x) => x.about === 'cs_e')
  eq(m.length, 2); eq(m[0].reason, 'reserved'); eq(m[1].reason, 'released')
})

await ok('a refund before dispatch puts the count back, with a reason', async () => {
  await reset(5)
  await take(1, 'sold', 'cs_f')
  eq((await row()).stocked, 4)
  await give(1, 'refunded', 'cs_f')
  eq((await row()).stocked, 5)
  const m = (await moves()).filter((x) => x.about === 'cs_f')
  eq(m.map((x) => x.reason).join(','), 'sold,refunded')
  eq(m[0].delta, -1); eq(m[1].delta, 1)
})

await ok('every change leaves a movement, and a movement says what it was for', async () => {
  await reset(10)
  await take(1, 'sold', 'cs_g')
  await give(2, 'received', 'po_1')
  const m = await moves()
  eq(m.length, 2)
  eq(m.every((x) => x.reason && x.at), true, 'each has a reason and a moment')
  eq(m[1].about, 'po_1', 'and what it was for')
})

await ok('a count is never driven below zero, whatever is asked', async () => {
  await reset(2)
  const { data } = await take(5, 'sold', 'cs_h')
  eq(data, false, 'asking for more than there is fails rather than going negative')
  eq((await row()).stocked, 2, 'and nothing moved')
  eq((await moves()).length, 0, 'a refused take writes no movement')
})

await ok('each shape is counted on its own', async () => {
  await db.from('inventory_movements').delete().eq('sku', SKU)
  await db.from('inventory').delete().eq('sku', SKU)
  await db.from('inventory').insert([{ sku: SKU, variant: 'linen.lined', stocked: 2 }, { sku: SKU, variant: 'leather.lined', stocked: 0 }])
  eq((await take(1, 'sold', 'cs_i', 'linen.lined')).data, true)
  eq((await take(1, 'sold', 'cs_j', 'leather.lined')).data, false, 'the leather is out; the linen is not')
  eq((await row('linen.lined')).stocked, 1)
})

await ok('a shopper may read what is left and may never write it', async () => {
  const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '', { auth: { persistSession: false } })
  const { data } = await anon.from('inventory').select('sku').eq('sku', SKU)
  if (!Array.isArray(data)) throw new Error('a reader could not read the counts, and a card needs to')
  const { error } = await anon.from('inventory').update({ stocked: 999 }).eq('sku', SKU)
  const after = await row('linen.lined')
  if (!error && after.stocked === 999) throw new Error('a reader was able to set a count')
  const { error: e2 } = await anon.rpc('inventory_take', { p_sku: SKU, p_variant: '', p_qty: 1, p_reason: 'sold', p_about: null })
  if (!e2) throw new Error('a reader was able to call inventory_take')
})

await ok('selling past zero is allowed where the file says so, and the count goes NEGATIVE', async () => {
  await reset(1)
  eq((await take(3, 'sold', 'cs_k', '', true)).data, true, 'a backorder is never refused')
  eq((await row()).stocked, -2, 'minus two is what the shop owes, and is the only number anybody can act on')
  const { data } = await db.rpc('inventory_available', { p_sku: SKU, p_variant: '' })
  eq(data, 0, 'available floors at nothing — a shopper is never told there are minus two')
})

await ok('and without it the same sale is refused', async () => {
  await reset(1)
  eq((await take(3, 'sold', 'cs_l')).data, false)
  eq((await row()).stocked, 1, 'nothing moved')
})
/*
 * A HOLD THAT NOTHING CAME BACK FOR.
 *
 * A reservation is released when Stripe says the checkout expired. That is the right hook and it
 * is ONE hook, arriving from outside: the secret can be unset, the endpoint can be down past
 * Stripe\u2019s retries, the event can simply never be configured. A hold never released is
 * permanent, and since `available` is stocked less reserved, the shop stops selling the thing \u2014
 * silently, and in the direction nobody notices until the takings are wrong.
 *
 * There was no floor under that at all until this test went looking for one.
 */
await ok('a hold older than any checkout could live is given back', async () => {
  await reset(5)
  await db.from('inventory').update({ reserved: 2 }).eq('sku', SKU)
  await db.from('inventory_movements').insert({ sku: SKU, variant: '', delta: 2, field: 'reserved', reason: 'reserved', about: 'cs_dead', at: new Date(Date.now() - 3 * 86400e3).toISOString() })
  const { data: n } = await db.rpc('inventory_sweep', {})
  eq(Number(n) >= 1, true, "the dead hold was swept")
  eq((await row()).reserved, 0)
  eq((await row()).stocked, 5, "and nothing was sold by giving it back")
})

await ok('and one from a checkout somebody is still in the middle of is left alone', async () => {
  await reset(5)
  await db.from('inventory').update({ reserved: 2 }).eq('sku', SKU)
  await db.from('inventory_movements').insert({ sku: SKU, variant: '', delta: 2, field: 'reserved', reason: 'reserved', about: 'cs_live' })
  await db.rpc('inventory_sweep', {})
  eq((await row()).reserved, 2, "a live hold must survive the sweep, or the sweep is the bug")
})
await db.from('inventory_movements').delete().eq('sku', SKU)
await db.from('inventory').delete().eq('sku', SKU)

console.log(`\ninventory-db: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
