<script setup>
/*
 * Orders — EVERY sale, and what has happened to it since: what was on it, what has been paid,
 * what has gone out and what has come back. One read (`admin_orders`), because four would be
 * four chances to show an order and its parcels from different moments.
 *
 * The printed copies are a FILTER of this page rather than a page of their own: a parcel from a
 * printer and a parcel off a shelf are the same fact about an order, and splitting them meant a
 * shop that sold both had to look in two places to see one sale.
 *
 * NOTHING ABOUT STATE IS READ FROM A COLUMN. Paid, part-paid, sent, part-sent — every one is
 * derived in the database from the rows it is a total of (43-orders.sql says why), so a cancelled
 * parcel changes what this page says with nothing told to recompute.
 *
 * A sale from before there were orders has no order; those come back as `loose` and are drawn
 * the same way, so nothing that was visible yesterday is invisible today. The rows are read with the
 * admin's own session (RLS: an administrator sees every purchase) and arrive live (the table is in
 * the realtime publication). Who bought is the row's address, and for an account its profile through
 * admin_people (profiles are self-select). What was bought is the site's offer by sku: the products
 * the files declare, and the formats a book in print sells. Words are content/app/ui/orders.md.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn, onIdentity } from 'platformkit/lib/auth.js'
import { books as BOOKS, products as PRODUCTS } from '#content'
import { formatOffers, parseVariant, PRINTED } from 'platformkit/lib/print-offers.js'
import AdminHead from './admin/AdminHead.vue'

const T = us('orders')
const H = T.orders.head, ST = T.orders.status, R = T.orders.row
const PW = (us('store').product || {}).print || {}
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

/* every sku the site sells → its title and kind: the products, then each book's formats */
const OFFERS = (() => {
  const m = new Map()
  for (const p of PRODUCTS || []) m.set(p.sku, { title: p.title, kind: p.kind, book: p.book || '' })
  for (const b of BOOKS || []) for (const f of formatOffers(b)) m.set(f.sku, { title: b.title, kind: f.kind, format: f.format, book: b.slug })
  return m
})()
const offerOf = (r) => OFFERS.get(r.sku) || { title: r.sku || r.key || '—', kind: 'good' }
const kindOf = (r) => offerOf(r).kind
const kindWord = (r) => R['kind-' + kindOf(r)] || kindOf(r)
const titleOf = (r) => { const o = offerOf(r); return o.format ? `${o.title} · ${PW['format-' + o.format] || o.format}` : o.title }
/* the variant: a printed book's contents · cloth · foil in the store's words; anything else (a size) as written */
const variantOf = (r) => {
  if (!r.variant) return ''
  const o = offerOf(r)
  if (o.format) { const v = parseVariant(r.variant); return [v.contents && (PW['contents-' + v.contents] || v.contents), v.cloth && (PW['cloth-' + v.cloth] || v.cloth), v.foil && (PW['foil-' + v.foil] || v.foil)].filter(Boolean).join(' · ') }
  return r.variant
}

const state = ref('idle')      /* idle | loading | ok | denied | error */
const rows = ref([])
const people = ref({})         /* user id → { name, email } */
const prints = ref({})         /* purchase id → print order id */
const filter = ref('all')
let channel = null

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; rows.value = []; return }
  state.value = 'loading'
  const { data, error } = await supabase.rpc('admin_orders', { p_limit: 200 })
  if (error) { state.value = (error.code === '42501' || /permission/i.test(error.message || '')) ? 'denied' : 'error'; return }
  if (!data) { state.value = 'denied'; return }
  /* an order and a loose purchase are drawn the same way, so they are made the same shape here
     rather than branched on in the template */
  rows.value = [
    ...(data.orders || []).map((o) => ({ ...o, kind: 'order' })),
    ...(data.loose || []).map((r) => ({
      kind: 'loose', id: r.id, created_at: r.created_at, email: r.email, user_id: r.user_id,
      currency: r.currency, total: r.amount_total, payment: r.status === 'refunded' ? 'refunded' : 'paid',
      fulfilment: null, checkout_session: r.session,
      lines: [{ line: r.id, sku: r.sku, variant: r.variant || '', title: r.title, variant_title: r.variant_title, unit_price: r.amount_total, quantity: r.quantity || 1 }],
      transactions: [], fulfilments: [], returns: [],
    })),
  ].sort((a2, b2) => String(b2.created_at).localeCompare(String(a2.created_at)))
  await names(rows.value)
  state.value = 'ok'
  listen()
}
async function names(list) {
  const ids = [...new Set(list.map((r) => r.user_id).filter((id) => id && !people.value[id]))]
  if (!ids.length) return
  const { data } = await supabase.rpc('admin_people', { ids })
  for (const p of data || []) people.value[p.id] = p
}
async function printLinks() {
  const { data } = await supabase.from('fulfilments').select('id, purchase_id').not('purchase_id', 'is', null).limit(500)
  const m = {}; for (const o of data || []) m[o.purchase_id] = o.id; prints.value = m
}
function listen() {
  if (channel || !supabase) return
  /* any of the four tables moving changes what this page says, and all four are totals — so the
     answer is asked for again rather than patched in place from the row that changed */
  channel = supabase.channel('orders')
  for (const table of ['orders', 'order_items', 'order_transactions', 'fulfilments', 'returns', 'purchases']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { load() })
  }
  channel.subscribe()
}
onMounted(load)
onIdentity(load)
onBeforeUnmount(() => { if (channel) supabase.removeChannel(channel); channel = null })

/* the kinds a line can be, and the three questions somebody comes to this page with: what still
   has to go out, what has come back, and what is at a printer — the last being the page that
   used to be its own */
const KINDS = ['book', 'download', 'good', 'membership', 'session', 'print']
const kindsIn = (r) => (r.lines || []).map((l) => kindOf(l))
const MATCH = {
  all: () => true,
  unfulfilled: (r) => r.fulfilment === 'unfulfilled' || r.fulfilment === 'part_fulfilled',
  returns: (r) => (r.returns || []).length > 0,
  refunded: (r) => r.payment === 'refunded' || r.payment === 'part_refunded',
  /* `f.book` was one of print's own columns on the fulfilment; they are empty now and the facts
     live in `chosen`, so reading it meant this half of the test had quietly stopped working */
  print: (r) => (r.fulfilments || []).some((f) => f.chosen && f.chosen.book) || kindsIn(r).includes('print'),
}
const matches = (r, f) => (MATCH[f] ? MATCH[f](r) : kindsIn(r).includes(f))
const shown = computed(() => rows.value.filter((r) => matches(r, filter.value)))
const FILTERS = ['all', 'unfulfilled', 'print', 'returns', ...KINDS.filter((k) => k !== 'print'), 'refunded']
const counts = computed(() => Object.fromEntries(FILTERS.map((f) => [f, rows.value.filter((r) => matches(r, f)).length])))
const filters = computed(() => FILTERS.filter((f) => f === 'all' || counts.value[f]))

const who = (r) => (r.user_id && people.value[r.user_id]) || null
const when = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const cash = (n, cur) => (typeof n === 'number' ? new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(n / 100) : '')
const money = (r) => cash(r.total, r.currency)
/* what has actually been taken: the transactions, which is the same sum the database derives
   its payment state from — shown beside the total so a part-paid order says how far short it is */
const taken = (r) => (r.transactions || []).reduce((n, t) => n + (t.amount || 0), 0)
/*
 * SEND IT AGAIN, AND ASK THE PRINTER WHERE IT IS.
 *
 * These two lived on a Print orders page of its own. That page became a FILTER of this one and the
 * router was pointed here — but the actions did not come with it, so for a while a failed print
 * job could not be retried from the admin at all, and nothing said so: the page listed the failure
 * and offered nothing to do about it. `print-order` is admins-only and does the deciding; this
 * only asks.
 */
const busy = reactive({}), said = reactive({})
const canSend = (f) => f.status === 'new' || f.status === 'failed'
const act = async (f, action) => {
  busy[f.id] = action; said[f.id] = ''
  try {
    const { data, error } = await supabase.functions.invoke('print-order', { body: { id: f.id, action } })
    if (error) throw error
    said[f.id] = action === 'submit' && data && data.ok ? R.went : ''
    await load()
  } catch (e) { said[f.id] = String((e && e.message) || e).slice(0, 120) }
  finally { busy[f.id] = '' }
}

const sentOf = (r) => (r.fulfilments || []).filter((f) => !['rejected', 'canceled', 'failed'].includes(f.status)).reduce((n, f) => n + (f.quantity || 0), 0)
const wantOf = (r) => (r.lines || []).filter((l) => !l.removed).reduce((n, l) => n + (l.quantity || 0), 0)
const lineTitle = (l) => (OFFERS.get(l.sku) || {}).title || l.title || l.sku || '—'
const lineShape = (l) => l.variant_title || variantOf(l)
const stripeUrl = (r) => (/^cs_(live|test)_/.test(r.checkout_session || '') ? 'https://dashboard.stripe.com/checkout/sessions/' + r.checkout_session : '')
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page po">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="po-seg">
          <button v-for="f in filters" :key="f" type="button" :class="{ on: filter === f }" @click="filter = f">{{ H['filter-' + f] }} <i>{{ counts[f] }}</i></button>
          <button type="button" class="po-refresh" @click="load">{{ H.refresh }}</button>
        </div>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="po-note">
      <h2>{{ T.page.head['signin-heading'] }}</h2><p>{{ T.page.head['signin-subtitle'] }}</p>
      <button type="button" class="po-cta" @click="openAuth">{{ T.page.head['signin-cta'] }}</button>
    </div>
    <div v-else-if="state === 'denied'" class="po-note"><h2>{{ T.page.head['denied-heading'] }}</h2><p>{{ T.page.head['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="po-note"><h2>{{ T.page.head['error-heading'] }}</h2><p>{{ T.page.head['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="po-loading">{{ H.loading }}</p>

    <template v-else-if="state === 'ok'">
      <p v-if="!shown.length" class="po-empty">{{ H.empty }}</p>
      <ul v-else class="po-list">
        <li v-for="r in shown" :key="r.id" class="po-row">
          <!-- WHAT IT IS: the number, what has been paid, what has gone out -->
          <div class="po-top">
            <span v-if="r.number" class="po-no">{{ R.order }} #{{ r.number }}</span>
            <span class="po-status" :class="'st-' + r.payment">{{ ST[r.payment] || r.payment }}</span>
            <span v-if="r.fulfilment && r.fulfilment !== 'nothing_to_send'" class="po-status" :class="'st-' + r.fulfilment">{{ ST[r.fulfilment] || r.fulfilment }}</span>
            <span v-for="rt in r.returns" :key="rt.id" class="po-status st-return">{{ ST[rt.status] || rt.status }}</span>
            <span class="po-amount">{{ money(r) }}</span>
            <span v-if="r.payment === 'part_paid'" class="po-short">{{ fill(R['paid-of'], { paid: cash(taken(r), r.currency), total: money(r) }) }}</span>
            <span class="po-when">{{ R.ordered }} {{ when(r.created_at) }}</span>
          </div>

          <!-- WHAT WAS ON IT -->
          <ul class="po-lines">
            <li v-for="l in r.lines" :key="l.line" :class="{ off: l.removed }">
              <b>{{ lineTitle(l) }}</b>
              <i v-if="lineShape(l)">{{ lineShape(l) }}</i>
              <span class="po-q">×{{ l.quantity }}</span>
              <span class="po-each">{{ cash(l.unit_price, r.currency) }} {{ R.each }}</span>
            </li>
          </ul>

          <dl class="po-facts">
            <div><dt>{{ R.buyer }}</dt><dd><template v-if="who(r)">{{ who(r).name }} <i>· {{ who(r).email }}</i></template><template v-else>{{ r.email || '—' }} <i>· {{ R.guest }}</i></template></dd></div>
            <div v-if="r.fulfilments && r.fulfilments.length">
              <dt>{{ R.fulfilments }} <i>{{ fill(R['sent-of'], { sent: sentOf(r), want: wantOf(r) }) }}</i></dt>
              <dd>
                <p v-for="f in r.fulfilments" :key="f.id" class="po-parcel">
                  <span class="po-status" :class="'st-' + f.status">{{ ST[f.status] || f.status }}</span>
                  <span class="po-by">{{ f.supplier }}</span>
                  <a v-if="f.tracking && f.tracking.number" class="po-track" :href="'https://www.google.com/search?q=' + f.tracking.number" target="_blank" rel="noopener">{{ f.tracking.number }}</a>
                  <em v-if="f.error" class="po-err">{{ f.error }}</em>
                  <button v-if="canSend(f)" type="button" class="po-act" :disabled="!!busy[f.id]" @click="act(f, 'submit')">{{ busy[f.id] === 'submit' ? R.checking : (f.status === 'failed' ? R['try-again'] : R['send-again']) }}</button>
                  <button v-else-if="f.supplier_job && f.status !== 'shipped'" type="button" class="po-act ghost" :disabled="!!busy[f.id]" @click="act(f, 'refresh')">{{ busy[f.id] === 'refresh' ? R.checking : R['check-now'] }}</button>
                  <i v-if="said[f.id]" class="po-said">{{ said[f.id] }}</i>
                </p>
              </dd>
            </div>
            <div v-if="r.returns && r.returns.length">
              <dt>{{ R.returns }}</dt>
              <dd><p v-for="rt in r.returns" :key="rt.id">{{ ST[rt.status] || rt.status }}<i v-if="rt.reason"> · {{ rt.reason }}</i></p></dd>
            </div>
            <div v-if="r.transactions && r.transactions.length">
              <dt>{{ R.transactions }}</dt>
              <dd><p v-for="(t, i) in r.transactions" :key="i">{{ R[t.reason] || t.reason }} {{ cash(t.amount, r.currency) }}</p></dd>
            </div>
            <div v-if="r.version > 1"><dt>{{ R.version }}</dt><dd>{{ fill(R.version, { n: r.version - 1 }) }}</dd></div>
            <div v-if="r.checkout_session"><dt>{{ R.session }}</dt><dd><a v-if="stripeUrl(r)" :href="stripeUrl(r)" target="_blank" rel="noopener">{{ r.checkout_session }}</a><template v-else>{{ r.checkout_session }}</template></dd></div>
          </dl>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.po { color: var(--ink) }
.po-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card); flex-wrap: wrap }
.po-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer }
.po-seg button i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 2px }
.po-seg button.on { background: var(--ink); color: var(--paper) } .po-seg button.on i { color: var(--paper); opacity: .7 }
.po-refresh { color: var(--accent2) !important }
.po-act { font: inherit; font-size: 12px; border: 1px solid var(--hair); background: var(--card); color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer }
.po-act:hover:not(:disabled) { border-color: var(--accent); color: var(--accent2) }
.po-act:disabled { opacity: .55; cursor: default }
.po-act.ghost { background: none }
.po-said { color: var(--ink3); font-style: normal; font-size: 12px }
.po-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.po-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .po-note p { color: var(--ink2); margin: 0 0 16px }
.po-cta { border: 0; background: var(--ink); color: var(--paper); font: inherit; padding: 10px 18px; border-radius: 999px; cursor: pointer }
.po-loading, .po-empty { color: var(--ink3); text-align: center; padding: 40px 0 }
.po-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px }
.po-row { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card) }
.po-no { font-family: var(--m); font-size: 12px; color: var(--ink3) }
.po-short { font-size: 12.5px; color: var(--ink3) }
/* WHAT WAS ON IT: a line each, the shape under its name, the price per one at the end */
.po-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px }
.po-lines li { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px }
.po-lines li.off { opacity: .45; text-decoration: line-through }
.po-lines b { font-family: var(--fd); font-weight: 600; font-size: 15px }
.po-lines i { font-style: normal; color: var(--ink3); font-size: 12.5px }
.po-q { font-family: var(--m); font-size: 12px; color: var(--ink2) }
.po-each { margin-left: auto; font-family: var(--m); font-size: 12px; color: var(--ink3) }
/* a parcel: what it is, who made it, where it is */
.po-parcel { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0 0 4px }
.po-by { color: var(--ink3); font-size: 12.5px }
.po-track { font-family: var(--m); font-size: 12px }
.po-err { font-style: normal; color: #b45309; font-size: 12.5px }
.po-main { flex: 1; min-width: 0 }
.po-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px }
.po-book { font-family: var(--fd); font-size: 17px; font-weight: 600 }
.po-kind { font-size: 12px; color: var(--ink3) }
.po-qty { color: var(--ink2); font-size: 13px } .po-amount { font-family: var(--m); font-size: 13px } .po-when { color: var(--ink3); font-size: 12.5px; margin-left: auto }
.po-status { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink2) }
.po-status.st-paid { border-color: #3a8f5c; color: #3a8f5c }
.po-status.st-refunded, .po-status.st-part_refunded, .po-status.st-rejected, .po-status.st-failed, .po-status.st-canceled { border-color: #b45309; color: #b45309 }
.po-status.st-fulfilled, .po-status.st-shipped { border-color: #3a8f5c; color: #3a8f5c }
.po-status.st-unpaid, .po-status.st-unfulfilled { border-color: var(--hair); color: var(--ink3) }
.po-status.st-part_paid, .po-status.st-part_fulfilled, .po-status.st-submitted, .po-status.st-in_production { border-color: var(--ink3); color: var(--ink2) }
.po-status.st-return, .po-status.st-requested, .po-status.st-received { border-color: #7c3aed; color: #7c3aed }
.po-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 22px; margin: 0 }
.po-facts div { min-width: 0 } .po-facts dt { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 3px }
.po-facts dd { margin: 0; font-size: 13.5px; line-height: 1.45; overflow-wrap: anywhere } .po-facts dd i { font-style: normal; color: var(--ink3) }
.po-facts dd a { color: var(--accent2) }
</style>
