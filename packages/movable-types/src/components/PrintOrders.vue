<script setup>
/*
 * Print orders — every hardcover bought, as the ledger wrote it (fulfilments:
 * the address Stripe collected, the edition printed, the printer's job and its
 * status, the tracking once shipped). The rows are read with the admin's own
 * session (RLS: an admin sees every order) and move as the printer's webhook
 * moves them (the table is in the realtime publication). Two actions go through
 * the print-order function: send a new or failed order to the printer, and check
 * a job's status now. Words are content/app/ui/orders.md.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { isSignedIn, onIdentity } from '@platform-kit/kit/lib/auth.js'
import { books as BOOKS } from '#content'
import AdminHead from './admin/AdminHead.vue'

const T = us('orders')
const H = T.page.head
const ST = T.page.status
const R = T.page.row
/* a status's word: the keys are hyphenated, the column's values underscored */
const statusWord = (st) => ST[String(st || '').replace(/_/g, '-')] || st
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const state = ref('idle')      /* idle | loading | ok | denied | error */
const rows = ref([])
const filter = ref('all')
const busy = reactive({})
const said = reactive({})
let channel = null

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; rows.value = []; return }
  state.value = 'loading'
  const { data, error } = await supabase.from('fulfilments').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) { state.value = (error.code === '42501' || /permission/i.test(error.message || '')) ? 'denied' : 'error'; return }
  rows.value = data || []
  state.value = 'ok'
  listen()
}
function listen() {
  if (channel || !supabase) return
  channel = supabase.channel('fulfilments').on('postgres_changes', { event: '*', schema: 'public', table: 'fulfilments' }, (p) => {
    if (p.eventType === 'DELETE') { rows.value = rows.value.filter((r) => r.id !== p.old.id); return }
    const i = rows.value.findIndex((r) => r.id === p.new.id)
    if (i >= 0) rows.value.splice(i, 1, p.new); else rows.value.unshift(p.new)
  }).subscribe()
}
onMounted(load)
onIdentity(load)
onBeforeUnmount(() => { if (channel) supabase.removeChannel(channel); channel = null })

const OPEN = ['new', 'submitted', 'in_production'], TROUBLE = ['failed', 'rejected']
const shown = computed(() => rows.value.filter((r) => filter.value === 'all' || (filter.value === 'open' ? OPEN.includes(r.status) : filter.value === 'shipped' ? r.status === 'shipped' : TROUBLE.includes(r.status))))
const counts = computed(() => ({ all: rows.value.length, open: rows.value.filter((r) => OPEN.includes(r.status)).length, shipped: rows.value.filter((r) => r.status === 'shipped').length, trouble: rows.value.filter((r) => TROUBLE.includes(r.status)).length }))

const bookTitle = (slug) => { const b = BOOKS.find((x) => x.slug === slug); return b ? b.title : slug }
const when = (d) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const addressLines = (a) => [a.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter((x) => x && String(x).trim())
const money = (c) => (c && typeof c.print === 'number' ? new Intl.NumberFormat(undefined, { style: 'currency', currency: c.currency || 'USD' }).format(c.print + (c.shipping || 0)) : '')
const canSubmit = (r) => r.status === 'new' || r.status === 'failed'

async function act(r, action) {
  busy[r.id] = action
  try {
    const { data, error } = await supabase.functions.invoke('print-order', { body: { id: r.id, action } })
    if (error) throw error
    if (data && data.order) { const i = rows.value.findIndex((x) => x.id === r.id); if (i >= 0) rows.value.splice(i, 1, data.order) }
    said[r.id] = action === 'submit' && data && data.ok ? R.sent : ''
  } catch (e) { said[r.id] = (e && e.message) || 'failed' }
  busy[r.id] = ''
}
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page po">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="po-seg">
          <button v-for="f in ['all', 'open', 'shipped', 'trouble']" :key="f" type="button" :class="{ on: filter === f }" @click="filter = f">{{ H['filter-' + f] }} <i>{{ counts[f] }}</i></button>
          <button type="button" class="po-refresh" @click="load">{{ H.refresh }}</button>
        </div>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="po-note">
      <h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p>
      <button type="button" class="po-cta" @click="openAuth">{{ H['signin-cta'] }}</button>
    </div>
    <div v-else-if="state === 'denied'" class="po-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'error'" class="po-note"><h2>{{ H['error-heading'] }}</h2><p>{{ H['error-subtitle'] }}</p></div>
    <p v-else-if="state === 'loading'" class="po-loading">{{ H.loading }}</p>

    <template v-else-if="state === 'ok'">
      <p v-if="!shown.length" class="po-empty">{{ H.empty }}</p>
      <ul v-else class="po-list">
        <li v-for="r in shown" :key="r.id" class="po-row" :class="'st-' + r.status">
          <div class="po-main">
            <div class="po-top">
              <span class="po-status" :class="'st-' + r.status">{{ statusWord(r.status) }}</span>
              <span v-if="r.proof" class="po-proof">{{ R.proof }}</span>
              <b class="po-book">{{ bookTitle((r.chosen || {}).book) }}</b>
              <span class="po-qty">{{ r.quantity > 1 ? fill(R.copies, { n: r.quantity }) : R.copy }}</span>
              <span class="po-when">{{ R.ordered }} {{ when(r.created_at) }}</span>
            </div>
            <dl class="po-facts">
              <div><dt>{{ R.buyer }}</dt><dd>{{ r.email || '—' }}</dd></div>
              <div><dt>{{ R.address }}</dt><dd><span v-for="(l, i) in addressLines(r.address || {})" :key="i" class="po-addr">{{ l }}</span></dd></div>
              <div><dt>{{ R.edition }}</dt><dd>{{ (r.chosen || {}).edition || R['no-edition'] }}</dd></div>
              <div v-if="r.supplier_job"><dt>{{ R.job }}</dt><dd><i v-if="r.supplier">{{ r.supplier }} · </i>{{ r.supplier_job }}<i v-if="r.supplier_status"> · {{ r.supplier_status }}</i></dd></div>
              <div v-if="r.tracking && r.tracking.id"><dt>{{ R.tracking }}</dt><dd><a v-if="r.tracking.url" :href="r.tracking.url" target="_blank" rel="noopener">{{ r.tracking.carrier ? r.tracking.carrier + ' ' : '' }}{{ r.tracking.id }}</a><template v-else>{{ r.tracking.carrier ? r.tracking.carrier + ' ' : '' }}{{ r.tracking.id }}</template></dd></div>
              <div v-if="money(r.cost)"><dt>{{ R.cost }}</dt><dd>{{ money(r.cost) }}</dd></div>
              <div v-if="r.error" class="po-err"><dt>{{ R.error }}</dt><dd>{{ r.error }}</dd></div>
            </dl>
          </div>
          <div class="po-acts">
            <button v-if="canSubmit(r)" type="button" class="po-btn" :disabled="!!busy[r.id]" @click="act(r, 'submit')">{{ busy[r.id] === 'submit' ? R.refreshing : (r.status === 'failed' ? R.retry : R.submit) }}</button>
            <button v-else-if="r.supplier_job && r.status !== 'shipped'" type="button" class="po-btn ghost" :disabled="!!busy[r.id]" @click="act(r, 'refresh')">{{ busy[r.id] === 'refresh' ? R.refreshing : R['refresh-one'] }}</button>
            <span v-if="said[r.id]" class="po-said">{{ said[r.id] }}</span>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.po { color: var(--ink) }
.po-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px }
.po-title { font-family: var(--fd); font-weight: 600; font-size: 34px; letter-spacing: -.02em; margin: 0 0 6px }
.po-subtitle { margin: 0; color: var(--ink2); font-size: 15px }
.po-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card) }
.po-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer }
.po-seg button i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 2px }
.po-seg button.on { background: var(--ink); color: var(--paper) } .po-seg button.on i { color: var(--paper); opacity: .7 }
.po-refresh { color: var(--accent2) !important }
.po-proof { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--accent2); color: var(--accent2) }
.po-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.po-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .po-note p { color: var(--ink2); margin: 0 0 16px }
.po-cta { border: 0; background: var(--ink); color: var(--paper); font: inherit; padding: 10px 18px; border-radius: 999px; cursor: pointer }
.po-loading, .po-empty { color: var(--ink3); text-align: center; padding: 40px 0 }
.po-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px }
.po-row { display: flex; gap: 20px; align-items: flex-start; padding: 18px 20px; border: 1px solid var(--hair); border-radius: 14px; background: var(--card) }
.po-main { flex: 1; min-width: 0 }
.po-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px }
.po-book { font-family: var(--fd); font-size: 17px; font-weight: 600 }
.po-qty { color: var(--ink2); font-size: 13px } .po-when { color: var(--ink3); font-size: 12.5px; margin-left: auto }
.po-status { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink2) }
.po-status.st-in_production, .po-status.st-submitted { border-color: var(--accent2); color: var(--accent2) }
.po-status.st-shipped { border-color: #3a8f5c; color: #3a8f5c }
.po-status.st-failed, .po-status.st-rejected { border-color: #b45309; color: #b45309 }
.po-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 22px; margin: 0 }
.po-facts div { min-width: 0 } .po-facts dt { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 3px }
.po-facts dd { margin: 0; font-size: 13.5px; line-height: 1.45; overflow-wrap: anywhere } .po-facts dd i { font-style: normal; color: var(--ink3) }
.po-facts dd a { color: var(--accent2) }
.po-addr { display: block }
.po-err dd { color: #b45309 }
.po-acts { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex: 0 0 auto }
.po-btn { border: 0; background: var(--ink); color: var(--paper); font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 999px; cursor: pointer; white-space: nowrap }
.po-btn.ghost { background: transparent; color: var(--ink2); border: 1px solid var(--hair) }
.po-btn:disabled { opacity: .5; cursor: default }
.po-said { font-size: 12px; color: var(--ink3); max-width: 220px; text-align: right }
@media (max-width: 640px) { .po-row { flex-direction: column } .po-acts { align-items: flex-start } }
</style>
