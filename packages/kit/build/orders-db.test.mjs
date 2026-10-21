/*
 * AN ORDER HAS A LIFE, against the real database — because every claim here is a claim about what
 * the SQL does, and three of them cannot be made over plain objects at all:
 *
 *   the transactions SUM to the total, refused AT THE WRITE. A check that ran afterwards would
 *   leave a row that should never have existed for somebody to find later;
 *
 *   fulfilment and payment state are DERIVED. The only way to prove a number is not stored is to
 *   change the rows it is a total of and read it again;
 *
 *   stock comes back on RECEIVED and never on requested — a trigger, and the difference between
 *   the two moments is the whole point.
 *
 * Skipped with a note naming what it did not cover when the stack is down.
 *
 *   node packages/kit/build/orders-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('orders-db: ' + m)
if (process.env.ORDERS_TEST === '0') { note('skipped (ORDERS_TEST=0) — nothing about orders, fulfilments, transactions or returns was covered'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env; nothing about orders, fulfilments, transactions or returns was covered'); leave(0) }
const key = serviceKey()
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up; nothing about orders, fulfilments, transactions or returns was covered'); leave(0) }

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n    ')) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const rpc = async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(fn + ': ' + error.message); return data }
/* a write whose error is not read is a write that looks like a silent no-op: the restock trigger
   was raising on every return and this test reported "expected 13, got 10" for an hour */
const must = async (q, what) => { const { error } = await q; if (error) throw new Error(what + ': ' + error.message) }

const SKU = 'probe-orders'
/* one order, two lines, nothing paid and nothing sent */
async function order({ shipping = 0, lines = [{ q: 2, p: 1000 }, { q: 1, p: 2500 }] } = {}) {
  const { data: o, error } = await db.from('orders').insert({ email: 'probe@example.com', currency: 'usd', shipping_total: shipping }).select().single()
  if (error) throw new Error('order: ' + error.message)
  const rows = lines.map((l, i) => ({ order_id: o.id, sku: SKU, variant: 'v' + i, title: 'A thing', unit_price: l.p, quantity: l.q }))
  const { data: items, error: e2 } = await db.from('order_items').insert(rows).select()
  if (e2) throw new Error('lines: ' + e2.message)
  return { ...o, items }
}
/* the key every fulfilment this file makes is written under, so clean() can find them again */
const FKEY = 'k'
const clean = async () => {
  const { data } = await db.from('orders').select('id').eq('email', 'probe@example.com')
  /* the fulfilments first: a row outlives its order on purpose — a parcel still ships when an
     order is reorganised — so deleting the order leaves them behind, and four of them survived
     every run of this file until somebody counted the rows */
  for (const o of data || []) await db.from('fulfilments').delete().eq('order_id', o.id)
  await db.from('fulfilments').delete().eq('key', FKEY)
  for (const o of data || []) await db.from('orders').delete().eq('id', o.id)
  await db.from('inventory').delete().eq('sku', SKU)
}
await clean()

console.log('\nAN ORDER HAS A LIFE\n')

/* ─────────────── 7.4 the transactions sum to the total ─────────────── */

await ok('what the order costs is its lines plus its shipping', async () => {
  const o = await order({ shipping: 500 })
  eq(await rpc('order_total', { p_order: o.id }), 2 * 1000 + 2500 + 500, 'total')
})

await ok('nothing paid is unpaid; part of it is part_paid; all of it is paid', async () => {
  const o = await order()                                  /* 4500 */
  eq(await rpc('order_payment', { p_order: o.id }), 'unpaid')
  await db.from('order_transactions').insert({ order_id: o.id, amount: 2000, reason: 'payment' })
  eq(await rpc('order_payment', { p_order: o.id }), 'part_paid')
  await db.from('order_transactions').insert({ order_id: o.id, amount: 2500, reason: 'payment' })
  eq(await rpc('order_payment', { p_order: o.id }), 'paid')
})

await ok('MORE CANNOT BE TAKEN THAN IS OWED, and the write is what refuses it', async () => {
  const o = await order()                                  /* 4500 */
  await db.from('order_transactions').insert({ order_id: o.id, amount: 4500, reason: 'payment' })
  const { error } = await db.from('order_transactions').insert({ order_id: o.id, amount: 1, reason: 'payment' })
  if (!error) throw new Error('a second capture over the total was allowed')
  if (!/more cannot be taken/i.test(error.message)) throw new Error('refused for the wrong reason: ' + error.message)
  /* and the row is not there afterwards, which is the difference between refusing and reporting */
  const { count } = await db.from('order_transactions').select('*', { count: 'exact', head: true }).eq('order_id', o.id)
  eq(count, 1, 'rows after the refusal')
})

await ok('and more cannot be given back than was taken', async () => {
  const o = await order()
  await db.from('order_transactions').insert({ order_id: o.id, amount: 1000, reason: 'payment' })
  const { error } = await db.from('order_transactions').insert({ order_id: o.id, amount: -2000, reason: 'refund' })
  if (!error) throw new Error('a refund larger than the payment was allowed')
  if (!/less than nothing/i.test(error.message)) throw new Error('refused for the wrong reason: ' + error.message)
})

await ok('a refund of everything reads as refunded, and of some of it as part_refunded', async () => {
  const o = await order()
  await db.from('order_transactions').insert({ order_id: o.id, amount: 4500, reason: 'payment' })
  await db.from('order_transactions').insert({ order_id: o.id, amount: -1000, reason: 'refund' })
  eq(await rpc('order_payment', { p_order: o.id }), 'part_paid', 'some given back leaves it short')
  await db.from('order_transactions').insert({ order_id: o.id, amount: 1000, reason: 'payment' })
  await db.from('order_transactions').insert({ order_id: o.id, amount: -4500, reason: 'refund' })
  eq(await rpc('order_payment', { p_order: o.id }), 'refunded')
})

/* ─────────────── 7.2 a fulfilment names its lines ─────────────── */

await ok('TWO FULFILMENTS AGAINST ONE ORDER IS ORDINARY — half today, half next week', async () => {
  const o = await order()                                  /* 2 of one line, 1 of another */
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'unfulfilled')

  const { data: f1 } = await db.from('fulfilments').insert({ order_id: o.id, key: FKEY, supplier: 'post-room', address: {}, status: 'shipped' }).select().single()
  await db.from('fulfilment_items').insert({ fulfilment_id: f1.id, line: o.items[0].line, quantity: 2 })
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'part_fulfilled', 'one line out of two')

  const { data: f2 } = await db.from('fulfilments').insert({ order_id: o.id, key: FKEY, supplier: 'post-room', address: {}, status: 'submitted' }).select().single()
  await db.from('fulfilment_items').insert({ fulfilment_id: f2.id, line: o.items[1].line, quantity: 1 })
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'fulfilled', 'both lines out')
})

await ok('a fulfilment that was rejected does not count as sent', async () => {
  const o = await order({ lines: [{ q: 1, p: 100 }] })
  const { data: f } = await db.from('fulfilments').insert({ order_id: o.id, key: FKEY, supplier: 'lulu', address: {}, status: 'rejected' }).select().single()
  await db.from('fulfilment_items').insert({ fulfilment_id: f.id, line: o.items[0].line, quantity: 1 })
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'unfulfilled', 'a refused parcel is not a sent one')
})

/* ─────────────── 7.3 nothing about state is stored ─────────────── */

await ok('FULFILMENT AND PAYMENT STATE ARE DERIVED: change the rows and the answer changes', async () => {
  const o = await order({ lines: [{ q: 1, p: 100 }] })
  const { data: f } = await db.from('fulfilments').insert({ order_id: o.id, key: FKEY, supplier: 'post-room', address: {}, status: 'shipped' }).select().single()
  await db.from('fulfilment_items').insert({ fulfilment_id: f.id, line: o.items[0].line, quantity: 1 })
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'fulfilled')
  /* the parcel is cancelled — nothing is told to recompute, because there is nothing to recompute */
  await must(db.from('fulfilments').update({ status: 'canceled' }).eq('id', f.id), 'cancelling the parcel')
  eq(await rpc('order_fulfilment', { p_order: o.id }), 'unfulfilled', 'the total followed the rows')
})

await ok('and no such column exists to be wrong', async () => {
  const { data } = await db.from('orders').select('*').limit(1)
  const cols = Object.keys((data && data[0]) || {})
  for (const bad of ['payment_status', 'fulfilment_status', 'fulfillment_status', 'total', 'paid']) {
    if (cols.includes(bad)) throw new Error('orders carries a stored `' + bad + '`, which the rows already say')
  }
})

/* ─────────────── 7.5 an edit raises the version ─────────────── */

await ok('AN EDIT RAISES THE VERSION AND COPIES FORWARD ONLY WHAT IT TOUCHED', async () => {
  const o = await order()                                  /* v1: 2×1000 and 1×2500 */
  eq(await rpc('order_total', { p_order: o.id }), 4500, 'at v1')
  const v = await rpc('order_edit', { p_order: o.id, p_lines: [{ line: o.items[0].line, quantity: 1 }] })
  eq(v, 2, 'the version')
  eq(await rpc('order_total', { p_order: o.id }), 1000 + 2500, 'at v2')
  /* the line nobody touched was not copied: it is still the row written at v1 */
  const { data: rows } = await db.from('order_items').select('line, version').eq('order_id', o.id)
  eq(rows.filter((r) => r.line === o.items[1].line).length, 1, 'the untouched line has one row')
  eq(rows.filter((r) => r.line === o.items[0].line).length, 2, 'the edited line has two')
})

await ok('AN INVOICE RENDERED AGAIN AT VERSION 1 SHOWS VERSION 1', async () => {
  const o = await order()
  await rpc('order_edit', { p_order: o.id, p_lines: [{ line: o.items[0].line, quantity: 5 }] })
  eq(await rpc('order_total', { p_order: o.id, p_version: 1 }), 4500, 'what the buyer was shown')
  eq(await rpc('order_total', { p_order: o.id }), 5 * 1000 + 2500, 'what it is now')
  const was = await rpc('order_lines', { p_order: o.id, p_version: 1 })
  eq(was.find((l) => l.line === o.items[0].line).quantity, 2, 'the quantity as it was')
})

await ok('a line removed by an edit leaves the versions before it readable', async () => {
  const o = await order()
  await rpc('order_edit', { p_order: o.id, p_lines: [{ line: o.items[1].line, removed: true }] })
  eq(await rpc('order_total', { p_order: o.id }), 2000, 'the removed line is off the total')
  eq(await rpc('order_total', { p_order: o.id, p_version: 1 }), 4500, 'and still on it at v1')
})

/* ─────────────── 7.6 returns, and the stock ─────────────── */

await ok('STOCK COMES BACK ON RECEIVED, AND NEVER ON REQUESTED', async () => {
  await db.from('inventory').delete().eq('sku', SKU)
  await db.from('inventory').insert({ sku: SKU, variant: 'v0', stocked: 10 })
  const o = await order({ lines: [{ q: 3, p: 100 }] })
  const { data: r } = await db.from('returns').insert({ order_id: o.id, order_version: 1, reason: 'changed their mind' }).select().single()
  await db.from('return_items').insert({ return_id: r.id, line: o.items[0].line, quantity: 3 })

  /* requested is a conversation: the shelf has not moved */
  eq(await rpc('inventory_available', { p_sku: SKU, p_variant: 'v0' }), 10, 'at requested')

  await must(db.from('returns').update({ status: 'received' }).eq('id', r.id), 'receiving the return')
  eq(await rpc('inventory_available', { p_sku: SKU, p_variant: 'v0' }), 13, 'at received')

  /* and it does not happen twice if the row is written again */
  await must(db.from('returns').update({ status: 'received', note: 'touched' }).eq('id', r.id), 'receiving the return')
  eq(await rpc('inventory_available', { p_sku: SKU, p_variant: 'v0' }), 13, 'a second write of the same status')
})

await ok('a damaged unit comes back to the shop and not to the shelf', async () => {
  await db.from('inventory').delete().eq('sku', SKU)
  await db.from('inventory').insert({ sku: SKU, variant: 'v0', stocked: 5 })
  const o = await order({ lines: [{ q: 1, p: 100 }] })
  const { data: r } = await db.from('returns').insert({ order_id: o.id, order_version: 1 }).select().single()
  await db.from('return_items').insert({ return_id: r.id, line: o.items[0].line, quantity: 1, restock: false })
  await must(db.from('returns').update({ status: 'received' }).eq('id', r.id), 'receiving the return')
  eq(await rpc('inventory_available', { p_sku: SKU, p_variant: 'v0' }), 5, 'the shelf is unchanged')
})

await ok('AN EXCHANGE IS A RETURN WITH AN OUTBOUND ORDER, not a fourth kind of thing', async () => {
  const back = await order({ lines: [{ q: 1, p: 100 }] })
  const out = await order({ lines: [{ q: 1, p: 100 }] })
  const { data: r, error } = await db.from('returns').insert({ order_id: back.id, order_version: 1, exchange_order_id: out.id }).select().single()
  if (error) throw new Error(error.message)
  eq(r.exchange_order_id, out.id, 'the thread between them')
  /* and it is a return like any other: its states, its items, its restock */
  eq(r.status, 'requested')
})

await ok('a return reads back against the version it was raised at', async () => {
  const o = await order()
  const { data: r } = await db.from('returns').insert({ order_id: o.id, order_version: 1 }).select().single()
  await db.from('return_items').insert({ return_id: r.id, line: o.items[0].line, quantity: 2 })
  await rpc('order_edit', { p_order: o.id, p_lines: [{ line: o.items[0].line, quantity: 1 }] })
  const was = await rpc('order_lines', { p_order: o.id, p_version: r.order_version })
  eq(was.find((l) => l.line === o.items[0].line).quantity, 2, 'what was actually sent')
})

/* ─────────────── the print orders that were here before ─────────────── */

await ok('a fulfilment made before any of this reads through chosen, with the dead columns empty', async () => {
  /* it used to filter on `book`, which every row now leaves null — so it matched nothing and
     passed by returning early, which is the shape of a check that has stopped checking. What is
     true now is the backfill's invariant: a row that was a printed copy says so in `chosen`,
     and print's own six columns are empty on every row. */
  const { data, error } = await db.from('fulfilments').select('supplier, status, chosen, variant, book, edition, format, contents, cloth, foil')
  if (error) throw new Error(error.message)
  if (!data.length) throw new Error('no fulfilment at all — the seed should hold one')
  const dead = data.filter((r) => r.book || r.edition || r.format || r.contents || r.cloth || r.foil)
  if (dead.length) throw new Error(dead.length + ' row(s) still carry print\'s own columns')
  /* a row carried over from before is only on a database that had rows before: one built from the files this run
     (the end-to-end run's) has none, and the invariant above — no row carries print's own columns — is the whole of it */
  const carried = data.filter((r) => r.chosen && r.chosen.book)
  if (carried.length) {
    if (!carried[0].supplier) throw new Error('the renamed column is empty')
    if (!carried[0].variant) throw new Error('a carried-over row has no variant')
  }
})

await clean()
console.log(fail ? `\norders-db: ${pass} passed, ${fail} FAILED\n` : `\norders-db: ${pass} passed\n`)
process.exit(fail ? 1 : 0)
