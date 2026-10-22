<script setup>
/*
 * PAYOUTS — what the business owes the people it pays, and the rules that decide it.
 *
 * Two lists and one honesty. The first list is who is owed something NOW, each with what stands in
 * the way said in words rather than left to be inferred from a greyed-out button. The second, inside
 * a person, is every line with the rule that made it — because "you were paid £340" is not an answer
 * to "why £340".
 *
 * The honesty: nothing here computes what anybody is owed. It reads the lines payouts_sweep wrote,
 * and the sweep is idempotent, so the button that runs it is safe to press twice. And where a
 * deployment has no payment keys — or the mock is on — the page says so rather than pretending money
 * moved.
 *
 * Rules are written HERE and nowhere else: a provider may not write the rule that says what they
 * earn, which the database holds and this page simply respects.
 *
 * Words: the `payouts` scope.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { TRIGGERS, AMOUNTS, ruleFault } from 'platformkit/lib/payouts.js'
import { sessions as SESSIONS } from '#content'
import AdminHead from './AdminHead.vue'

const W = computed(() => us('payouts').page.main)
const P = computed(() => us('payouts').page.person)
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const loading = ref(true), error = ref(''), busy = ref(''), note = ref('')
const due = ref([]), live = ref(false)
const openId = ref(''), person = ref(null), editing = ref(false), draft = ref(null)

const money = (c, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur || 'usd').toUpperCase() }).format((Number(c) || 0) / 100) } catch (e) { return String(c) } }
const when = (d) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(d)) } catch (e) { return '' } }
const forever = (d) => !d || new Date(d).getTime() > Date.now() + 100 * 365 * 864e5
const TYPES = computed(() => (SESSIONS || []).filter((s) => s.published !== false).map((s) => s.slug))

async function call(action, body) {
  const { data, error: e } = await supabase.functions.invoke('payouts', { body: { action, ...(body || {}) } })
  if (e) throw e
  if (data && data.error) throw new Error(data.error)
  return data
}
async function load() {
  loading.value = true; error.value = ''
  try { const r = await call('due'); due.value = r.due || []; live.value = !!r.live }
  catch (e) { error.value = e.message || W.value.error } finally { loading.value = false }
}
onMounted(load)

async function sweep() {
  busy.value = 'sweep'; error.value = ''; note.value = ''
  try {
    const r = await call('sweep')
    note.value = !r.written ? W.value['swept-none'] : r.written === 1 ? W.value['swept-one'] : fill(W.value.swept, { n: r.written })
    await load()
    if (openId.value) await openPerson(openId.value, true)
  } catch (e) { error.value = e.message || W.value.error } finally { busy.value = '' }
}
async function sendAll() {
  busy.value = 'send'; error.value = ''; note.value = ''
  try { const r = await call('send'); note.value = r.sent === 1 ? W.value['sent-one'] : fill(W.value.sent, { n: r.sent || 0 }); await load() }
  catch (e) { error.value = e.message || W.value.error } finally { busy.value = '' }
}
async function sendOne(d) {
  busy.value = d.user_id; error.value = ''; note.value = ''
  try { const r = await call('send', { user: d.user_id }); note.value = r.sent ? fill(W.value.sent, { n: 1 }) : (r.reason || ''); await load() }
  catch (e) { error.value = e.message || W.value.error } finally { busy.value = '' }
}
async function openPerson(id, keep) {
  if (!keep && openId.value === id) { openId.value = ''; person.value = null; return }
  openId.value = id; person.value = null; editing.value = false
  try { person.value = await call('status', { user: id }) } catch (e) { error.value = e.message || W.value.error }
}

/* --- the rules --- */
/* the FORM's amount is in the units a person types — dollars for a fixed amount, percent for a share
   — and is turned into the smallest unit (or basis points, which are the same arithmetic) on the way
   out. Switching the kind resets it, because 50 dollars and 50 percent are not the same number. */
const blank = () => ({ trigger: 'booking', booking_type: TYPES.value[0] || '', amount_kind: 'fixed', amount: 50, currency: 'usd', note: '' })
watch(() => draft.value && draft.value.amount_kind, (k, was) => { if (draft.value && k && was && k !== was) draft.value.amount = k === 'share' ? 10 : 50 })
function addRule() { draft.value = blank(); editing.value = true }
const asRule = computed(() => {
  const d = draft.value
  if (!d) return null
  return { ...d, booking_type: d.trigger === 'booking' ? d.booking_type : null, amount: Math.round(Number(d.amount) * 100) }
})
/* the pure rule, so the form refuses exactly what the database would and says the same sentence */
/* the pure rule refuses exactly what the database would; the page says it in its own words, since
   the shared message speaks of a 'booking' and this page's word for one is a session */
const fault = computed(() => {
  const f = asRule.value ? ruleFault(asRule.value) : null
  if (!f) return null
  return /share of/.test(f) ? P.value['share-on-period'] : f
})
async function saveRule() {
  if (!asRule.value || fault.value) return
  busy.value = 'rule'; error.value = ''
  try {
    const { error: e } = await supabase.from('payout_rules').insert({ user_id: openId.value, ...asRule.value })
    if (e) throw e
    editing.value = false; draft.value = null
    await openPerson(openId.value, true)
  } catch (e) { error.value = e.message || W.value.error } finally { busy.value = '' }
}
async function removeRule(r) {
  if (!window.confirm(P.value['remove-ask'])) return
  try { await supabase.from('payout_rules').update({ active: false }).eq('id', r.id); await openPerson(openId.value, true) }
  catch (e) { error.value = e.message || W.value.error }
}
const ruleWords = (r) => {
  const t = r.trigger === 'weekly' ? P.value['trigger-weekly'] : r.trigger === 'monthly' ? P.value['trigger-monthly'] : (r.booking_type || P.value['trigger-booking'])
  const a = r.amount_kind === 'share' ? (r.amount / 100).toFixed(2).replace(/\.00$/, '') + '%' : money(r.amount, r.currency)
  return a + ' · ' + t
}
</script>

<template>
  <div class="ui-page pa">
    <AdminHead :title="W.title" :sub="W.lead">
      <template #actions>
        <div class="pa-acts">
          <button type="button" class="pa-act" :disabled="busy === 'sweep'" @click="sweep">{{ busy === 'sweep' ? W.sweeping : W.sweep }}</button>
          <button type="button" class="pa-primary" :disabled="busy === 'send' || !due.some((d) => d.sendable)" @click="sendAll">{{ busy === 'send' ? W.sending : W['send-all'] }}</button>
        </div>
      </template>
    </AdminHead>
    <!-- WHERE NOTHING CAN REALLY BE SENT, the page says so rather than pretending -->
    <p v-if="!live" class="pa-mock">{{ W.mock }}</p>
    <p v-if="note" class="pa-note">{{ note }}</p>
    <p v-if="error" class="pa-err">{{ error }}</p>

    <h2 class="pa-sub">{{ W['due-title'] }}</h2>
    <p v-if="!loading && !due.length" class="pa-empty">{{ W['due-none'] }}</p>
    <ul v-else class="pa-due">
      <li v-for="d in due" :key="d.user_id" :class="{ open: openId === d.user_id }">
        <div class="pa-row">
          <b class="pa-amount" :class="{ owing: d.amount < 0 }">{{ money(d.amount, d.currency) }}</b>
          <span class="pa-who">{{ d.name || d.email }}</span>
          <!-- what stands in the way, in words -->
          <span v-if="d.why" class="pa-why">{{ d.why }}</span>
          <span class="pa-row-acts">
            <button type="button" class="pa-act" @click="openPerson(d.user_id)">{{ openId === d.user_id ? W.close : W.open }}</button>
            <button type="button" class="pa-act pa-go" :disabled="!d.sendable || busy === d.user_id" @click="sendOne(d)">{{ W['send-one'] }}</button>
          </span>
        </div>

        <div v-if="openId === d.user_id && person" class="pa-person">
          <ul class="pa-nums">
            <li><b>{{ money(person.balance.earned, person.balance.currency) }}</b><span>{{ P.earned }}</span></li>
            <li><b>{{ money(person.balance.payable, person.balance.currency) }}</b><span>{{ P.payable }}</span></li>
            <li><b>{{ money(person.balance.waiting, person.balance.currency) }}</b><span>{{ P.waiting }}</span></li>
            <li><b>{{ money(person.balance.sent, person.balance.currency) }}</b><span>{{ P.sent }}</span></li>
          </ul>
          <p class="pa-acct">{{ !person.account || !person.account.connected ? P['no-account'] : person.account.ready ? P.ready : P['not-ready'] }}</p>

          <h3 class="pa-sub3">{{ P.rules }}</h3>
          <ul v-if="person.rules && person.rules.length" class="pa-rules">
            <li v-for="r in person.rules" :key="r.id">
              <b>{{ ruleWords(r) }}</b>
              <span v-if="r.note" class="pa-rule-note">{{ r.note }}</span>
              <button type="button" class="pa-act" @click="removeRule(r)">{{ P.remove }}</button>
            </li>
          </ul>
          <p v-else class="pa-empty">{{ P['no-rules'] }}</p>

          <form v-if="editing" class="pa-form" @submit.prevent="saveRule">
            <label class="pa-field"><span>{{ P.trigger }}</span>
              <select v-model="draft.trigger">
                <option v-for="t in TRIGGERS" :key="t" :value="t">{{ P['trigger-' + t] }}</option>
              </select>
            </label>
            <label v-if="draft.trigger === 'booking'" class="pa-field"><span>{{ P.type }}</span>
              <select v-model="draft.booking_type"><option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option></select>
            </label>
            <label class="pa-field"><span>{{ P.kind }}</span>
              <select v-model="draft.amount_kind"><option v-for="k in AMOUNTS" :key="k" :value="k">{{ P['kind-' + k] }}</option></select>
            </label>
            <label class="pa-field"><span>{{ draft.amount_kind === 'share' ? P.share : P.amount }}</span>
              <input v-model.number="draft.amount" type="number" min="0" :step="draft.amount_kind === 'share' ? 0.5 : 1" />
            </label>
            <label class="pa-field pa-wide"><span>{{ P.note }}</span><input v-model="draft.note" type="text" maxlength="160" /></label>
            <p v-if="fault" class="pa-fault">{{ fault }}</p>
            <div class="pa-save">
              <button type="submit" class="pa-primary" :disabled="!!fault || busy === 'rule'">{{ busy === 'rule' ? P.saving : P.save }}</button>
              <button type="button" class="pa-act" @click="editing = false">{{ P.cancel }}</button>
            </div>
          </form>
          <button v-else type="button" class="pa-add" @click="addRule">{{ P['add-rule'] }}</button>

          <h3 class="pa-sub3">{{ P.lines }}</h3>
          <ul class="pa-lines">
            <li v-for="l in person.lines" :key="l.id" :class="{ 'is-reversal': l.amount < 0 || l.reverses }">
              <b>{{ money(l.amount, l.currency) }}</b>
              <span class="pa-about">{{ l.about }}</span>
              <span class="pa-state">{{ l.amount < 0 || l.reverses ? '' : l.paid_at ? when(l.paid_at) : forever(l.payable_at) ? '' : when(l.payable_at) }}</span>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>

.pa-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 0 0 20px }
.pa-head h1 { margin: 0 0 4px; font-family: var(--fd); font-size: 26px; font-weight: 600; color: var(--ink) }
.pa-head p { margin: 0; font-size: 14px; color: var(--ink3) }
.pa-acts { display: flex; gap: 8px }
.pa-primary { font: inherit; font-size: 13.5px; padding: 9px 18px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); cursor: pointer }
.pa-primary[disabled] { opacity: .4; cursor: default }
.pa-act { font: inherit; font-size: 12.5px; padding: 6px 13px; border: 1px solid var(--hair); border-radius: 999px; background: none; color: var(--ink2); cursor: pointer }
.pa-act:hover { border-color: var(--ink3); color: var(--ink) }
.pa-act[disabled] { opacity: .4; cursor: default }
.pa-go { border-color: color-mix(in srgb, var(--ink) 40%, transparent); color: var(--ink) }
.pa-mock { margin: 0 0 14px; padding: 10px 13px; font-size: 13px; color: var(--ink2); border: 1px dashed var(--hair); border-radius: 10px }
.pa-note { margin: 0 0 12px; font-size: 13px; color: var(--ink2) }
.pa-err { margin: 0 0 12px; font-size: 13px; color: #c4362a }
.pa-sub { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin: 22px 0 10px }
.pa-sub3 { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin: 18px 0 8px }
.pa-empty { font-size: 13.5px; color: var(--ink3); margin: 0 0 10px }
.pa-due { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px }
.pa-due > li { border: 1px solid var(--hair); border-radius: 12px; background: var(--card) }
/* named areas, because auto-placement put a two-row button group in the first column and left the
   person's own name with nowhere to go */
.pa-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; grid-template-areas: 'amount who acts' 'amount why acts'; align-items: center; gap: 2px 12px; padding: 13px 15px }
.pa-amount { grid-area: amount; font-family: var(--m); font-size: 15px; color: var(--ink) }
/* owed less than nothing is a reversal standing against what comes next, never a bill */
.pa-amount.owing { color: var(--ink3) }
.pa-who { grid-area: who; font-size: 14.5px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pa-why { grid-area: why; font-size: 12.5px; color: var(--ink3) }
.pa-row-acts { grid-area: acts; display: flex; gap: 6px; align-self: center }
.pa-person { padding: 4px 15px 16px; border-top: 1px dashed var(--hair) }
.pa-nums { list-style: none; margin: 12px 0 10px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px }
.pa-nums li { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px }
.pa-nums b { font-family: var(--fd); font-size: 17px; font-weight: 600; color: var(--ink) }
.pa-nums span { font-family: var(--m); font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.pa-acct { margin: 0; font-size: 13px; color: var(--ink3) }
.pa-rules { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 6px }
.pa-rules li { display: flex; align-items: baseline; gap: 12px; font-size: 13.5px }
.pa-rules li .pa-act { margin-left: auto }
.pa-rules b { font-family: var(--m); font-size: 13px; color: var(--ink) }
.pa-rule-note { color: var(--ink3) }
.pa-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px 12px; margin: 0 0 12px; padding: 12px; border: 1px dashed var(--hair); border-radius: 10px }
.pa-wide { grid-column: 1 / -1 }
.pa-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink3) }
.pa-field input, .pa-field select { font: inherit; font-size: 13.5px; color: var(--ink); padding: 8px 10px; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper) }
.pa-fault { grid-column: 1 / -1; margin: 0; font-size: 12.5px; color: #c4362a }
.pa-save { grid-column: 1 / -1; display: flex; gap: 10px; align-items: center }
.pa-add { font: inherit; font-size: 12.5px; padding: 7px 14px; border: 1px dashed var(--hair); border-radius: 999px; background: none; color: var(--ink2); cursor: pointer }
.pa-lines { list-style: none; margin: 0; padding: 0 }
.pa-lines li { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 8px 2px; border-bottom: 1px solid var(--hair); font-size: 13.5px }
.pa-lines li:last-child { border-bottom: 0 }
.pa-lines b { font-family: var(--m); font-size: 12.5px; color: var(--ink) }
.pa-lines li.is-reversal b { color: var(--ink3) }
.pa-about { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pa-state { font-family: var(--m); font-size: 11px; color: var(--ink3) }
@media (max-width: 640px) { .pa-row { grid-template-columns: 1fr; grid-template-areas: 'amount' 'who' 'why' 'acts'; gap: 6px } }
</style>
