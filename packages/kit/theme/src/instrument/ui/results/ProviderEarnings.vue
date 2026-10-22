<script setup>
/*
 * WHAT YOU HAVE EARNED — a provider's own ledger, on the Coaching tab beside their hours and what
 * they offer. Four numbers and the lines that made them:
 *
 *   EARNED is everything. PAYABLE is what the delay has released and nothing has paid. HELD is what
 *   it still holds. SENT is what went. They are four different numbers and a page that shows one of
 *   them and calls it another is the reason somebody thinks they have been underpaid.
 *
 * And it says which of two states they are in — earning, or earning AND able to be paid — because
 * connecting an account is not the same as having earned, and somebody half way through should be
 * told which. Nothing here is computed from a processor: it is the lines the sweep wrote.
 *
 * Words: library.md coaching.earnings.
 */
import { ref, computed, onMounted } from 'vue'
import { us } from '../strings.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { user } from 'platformkit/lib/auth.js'
import { balanceOf } from 'platformkit/lib/payouts.js'

const E = us('library').coaching.earnings || {}
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const open = ref(false), loading = ref(true), error = ref(''), busy = ref('')
const state = ref(null)

const lines = computed(() => (state.value && state.value.lines) || [])
const bal = computed(() => (state.value && state.value.balance) || balanceOf(lines.value))
const account = computed(() => (state.value && state.value.account) || null)
const currency = computed(() => (bal.value && bal.value.currency) || 'usd')
const money = (c) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency.value).toUpperCase() }).format((Number(c) || 0) / 100) } catch (e) { return String(c) } }
const days = computed(() => Math.round(((state.value && state.value.delay) || 0) / 1440))
const when = (d) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(d)) } catch (e) { return '' } }
/* INFINITY is what a refund inside the window leaves behind: the line never becomes payable. It is
   not a date and must never be drawn as one. */
const forever = (d) => !d || new Date(d).getTime() > Date.now() + 100 * 365 * 864e5

const summary = computed(() => {
  if (loading.value) return ''
  if (!lines.value.length) return E.nothing
  return [money(bal.value.payable) + ' ' + String(E.payable || '').toLowerCase(), bal.value.waiting ? money(bal.value.waiting) + ' ' + String(E.waiting || '').toLowerCase() : ''].filter(Boolean).join(' · ')
})

async function call(action, body) {
  const { data, error: e } = await supabase.functions.invoke('payouts', { body: { action, ...(body || {}) } })
  if (e) throw e
  if (data && data.error) throw new Error(data.error)
  return data
}
async function load() {
  if (!configured || !user.value) { loading.value = false; return }
  loading.value = true; error.value = ''
  try { state.value = await call('status') } catch (e) { error.value = e.message || E.error } finally { loading.value = false }
}
onMounted(load)
defineExpose({ reload: load })

async function connect() {
  busy.value = 'connect'; error.value = ''
  try {
    const r = await call('connect')
    if (r && r.url) { window.location.href = r.url; return }
    await load()
  } catch (e) { error.value = e.message || E.error } finally { busy.value = '' }
}
async function refresh() {
  busy.value = 'refresh'; error.value = ''
  try { await call('refresh'); await load() } catch (e) { error.value = e.message || E.error } finally { busy.value = '' }
}
</script>

<template>
  <section v-if="state" class="pe" :class="{ open }">
    <button type="button" class="pe-head" :aria-expanded="open" @click="open = !open">
      <span class="pe-title">{{ E.title }}</span>
      <span class="pe-sum">{{ summary }}</span>
      <span class="pe-btn">{{ open ? E.close : E.open }}</span>
    </button>
    <div v-if="open" class="pe-body">
      <p class="pe-lead">{{ E.lead }}</p>

      <!-- the four numbers, never one of them standing for another -->
      <ul class="pe-nums">
        <li><b>{{ money(bal.earned) }}</b><span>{{ E.earned }}</span></li>
        <li class="pe-big"><b>{{ money(bal.payable) }}</b><span>{{ E.payable }}</span></li>
        <li><b>{{ money(bal.waiting) }}</b><span>{{ E.waiting }}</span></li>
        <li><b>{{ money(bal.sent) }}</b><span>{{ E.sent }}</span></li>
      </ul>
      <p v-if="days" class="pe-note">{{ fill(E['waiting-note'], { days }) }}</p>

      <!-- EARNING AND BEING PAID ARE TWO STATES, and which one they are in is said plainly -->
      <div class="pe-acct">
        <template v-if="!account || !account.connected">
          <button type="button" class="pe-primary" :disabled="busy === 'connect'" @click="connect">{{ busy === 'connect' ? E.connecting : E.connect }}</button>
          <span class="pe-acct-note">{{ E['connect-note'] }}</span>
        </template>
        <template v-else-if="!account.ready">
          <span class="pe-acct-note">{{ E['not-ready'] }}</span>
          <button type="button" class="pe-act" :disabled="busy === 'connect'" @click="connect">{{ E.finish }}</button>
          <button type="button" class="pe-act" :disabled="busy === 'refresh'" @click="refresh">{{ E.refresh }}</button>
        </template>
        <template v-else>
          <span class="pe-acct-note pe-ok">{{ E.connected }}</span>
        </template>
      </div>

      <h4 v-if="lines.length" class="pe-sub">{{ E.lines }}</h4>
      <ul v-if="lines.length" class="pe-lines">
        <li v-for="l in lines" :key="l.id" :class="{ 'is-reversal': l.amount < 0 || l.reverses }">
          <b>{{ money(l.amount) }}</b>
          <span class="pe-about">{{ l.about }}</span>
          <span class="pe-state">
            <!-- A NEGATIVE LINE IS A REVERSAL, whatever it points at: one written before the
                 pointer existed would otherwise read "payable", which is money owed the wrong way. -->
            <template v-if="l.amount < 0 || l.reverses">{{ E['line-reversed'] }}</template>
            <template v-else-if="l.paid_at">{{ fill(E['line-paid'], { when: when(l.paid_at) }) }}</template>
            <template v-else-if="forever(l.payable_at)">{{ E['line-reversed'] }}</template>
            <template v-else-if="new Date(l.payable_at) <= new Date()">{{ fill(E['line-payable'], { when: when(l.payable_at) }) }}</template>
            <template v-else>{{ fill(E['line-held'], { when: when(l.payable_at) }) }}</template>
          </span>
        </li>
      </ul>
      <p v-else-if="!loading" class="pe-empty">{{ E.nothing }}</p>
      <em v-if="error" class="pe-err">{{ error }}</em>
    </div>
  </section>
</template>

<style scoped>
.pe { border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); margin: 0 0 var(--s3); padding: 0; overflow: hidden }   /* padding 0: the global stylesheet gives a section its own */
.pe-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; font: inherit; text-align: left; padding: 14px 16px; background: none; border: 0; color: var(--qink); cursor: pointer }
.pe-title { font-weight: 700; font-size: 15px }
.pe-sum { font-size: 13px; color: var(--qink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pe-btn { font-size: 13px; color: var(--qink2); padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; white-space: nowrap }
.pe-body { padding: 4px 16px 16px; border-top: 1px dashed var(--qhair) }
.pe-lead { font-size: 13.5px; color: var(--qink3); margin: 10px 0 14px }
.pe-nums { list-style: none; margin: 0 0 8px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px }
.pe-nums li { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid var(--qhair); border-radius: 12px }
.pe-nums b { font-family: var(--fd); font-size: 20px; font-weight: 600; color: var(--qink2) }
.pe-nums span { font-family: var(--m); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--qink3) }
/* PAYABLE is the one somebody came to see; the other three are context for it */
.pe-big b { color: var(--qink); font-size: 26px }
.pe-note { font-size: 12.5px; line-height: 1.5; color: var(--qink3); margin: 0 0 14px }
.pe-acct { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 16px; padding: 12px 14px; border: 1px dashed var(--qhair); border-radius: 12px }
.pe-acct-note { font-size: 13px; color: var(--qink3) }
.pe-ok { color: var(--qink2) }
.pe-primary { font: inherit; font-size: 13.5px; padding: 9px 18px; border: 0; border-radius: 999px; background: var(--qink); color: var(--qcard); cursor: pointer }
.pe-primary[disabled] { opacity: .5; cursor: default }
.pe-act { font: inherit; font-size: 12.5px; padding: 5px 11px; border: 1px solid var(--qhair); border-radius: 999px; background: none; color: var(--qink2); cursor: pointer }
.pe-sub { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--qink3); margin: 0 0 8px }
.pe-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.pe-lines li { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; align-items: baseline; gap: 12px; padding: 9px 4px; border-bottom: 1px solid var(--qhair); font-size: 13.5px }
.pe-lines li:last-child { border-bottom: 0 }
.pe-lines b { font-family: var(--m); font-size: 13px; color: var(--qink) }
.pe-lines li.is-reversal b { color: var(--qink3) }
.pe-about { color: var(--qink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pe-state { font-family: var(--m); font-size: 11px; color: var(--qink3); white-space: nowrap }
.pe-empty { font-size: 13.5px; color: var(--qink3); margin: 0 }
.pe-err { display: block; font-style: normal; font-size: 12.5px; color: var(--c3, #fc5151); margin-top: 8px }
@media (max-width: 560px) { .pe-lines li { grid-template-columns: 1fr auto; } .pe-about { grid-column: 1 / -1; white-space: normal } }
@media (max-width: 640px) { .pe-head { grid-template-columns: minmax(0, 1fr) auto } .pe-title { grid-row: 1 } .pe-btn { grid-row: 1; grid-column: 2; justify-self: end } .pe-sum { grid-column: 1 / -1; grid-row: 2; white-space: normal } }
</style>
