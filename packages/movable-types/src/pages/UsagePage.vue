<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { checkout } from '@platform-kit/kit/lib/commerce.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { products } from '#content'

const W = computed(() => ((us('usage').page || {}).main || {}))
const state = ref('loading')
const fault = ref('')
const topupFault = ref('')
const topupNotice = ref('')
const busy = ref(false)
const balances = ref([])
const history = ref([])
const topupConfig = ref({ enabled: false, currency: null, packs: [] })
const hasPaymentMethod = ref(false)
const topupEnabled = ref(false)
const selectedPack = ref('')
const threshold = ref('1')
const monthlyCap = ref('20')
const consent = ref(false)
let authListener

const usageOffers = computed(() => (products || []).filter((offer) => offer.published !== false && offer.usage))
const usagePacks = computed(() => usageOffers.value.filter((offer) =>
  offer.billing === 'once' && Number(offer.usage?.grant) > 0,
))
const eligiblePacks = computed(() => topupConfig.value.packs || [])
const selectedTopupPack = computed(() =>
  eligiblePacks.value.find((pack) => pack.key === selectedPack.value) || eligiblePacks.value[0] || null,
)
const titleOf = (key) => usageOffers.value.find((offer) => offer.key === key)?.title || W.value.archived
const unitOf = (key, value) => usageOffers.value.find((offer) => offer.key === key)?.usage?.unit || value || ''
const numberOf = (micros) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(micros || 0) / 1_000_000)
const moneyOf = (amount, currency = 'usd') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: String(currency || 'usd').toUpperCase(), maximumFractionDigits: 2,
}).format(Number(amount || 0))
const timeOf = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const kindOf = (kind) => W.value[`kind-${kind}`] || W.value['kind-other']
const topupAvailable = computed(() => topupConfig.value.enabled && eligiblePacks.value.length > 0)

async function topupRequest(body) {
  const { data, error } = await supabase.functions.invoke('usage-topup', { body })
  if (error) {
    let detail = error.message || ''
    let code = ''
    try {
      const payload = await error.context?.clone?.().json()
      detail = payload?.error || detail
      code = payload?.code || ''
    } catch {}
    const failure = new Error(detail || W.value['request-error'])
    failure.code = code
    throw failure
  }
  if (data?.error) {
    const failure = new Error(data.error)
    failure.code = data.code || ''
    throw failure
  }
  return data
}

async function load() {
  state.value = 'loading'
  fault.value = ''
  const { data: { session }, error: authError } = await supabase.auth.getSession()
  if (authError) throw authError
  const user = session?.user
  if (!user) {
    state.value = 'signed-out'
    return
  }
  const [balanceResult, historyResult] = await Promise.all([
    supabase.from('usage_balances')
      .select('offer_key, period_start, granted_micros, used_micros, reserved_micros, remaining_micros')
      .eq('user_id', user.id),
    supabase.from('usage_events')
      .select('id, offer_key, kind, units_micros, usage_unit, seconds_micros, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  if (balanceResult.error) throw balanceResult.error
  if (historyResult.error) throw historyResult.error
  balances.value = balanceResult.data || []
  history.value = historyResult.data || []
  state.value = 'ready'
  await loadTopup()
}

async function loadTopup() {
  topupFault.value = ''
  try {
    const result = await topupRequest({ action: 'read' })
    topupConfig.value = result.config || { enabled: false, currency: null, packs: [] }
    hasPaymentMethod.value = result.has_payment_method === true
    topupEnabled.value = result.preferences?.enabled === true
    selectedPack.value = result.preferences?.offer_key || eligiblePacks.value[0]?.key || ''
    if (result.preferences?.threshold_micros != null) {
      threshold.value = numberOf(result.preferences.threshold_micros)
    }
    if (result.preferences?.monthly_cap_minor != null) {
      monthlyCap.value = String(Number(result.preferences.monthly_cap_minor) / 100)
    }
    consent.value = !!result.preferences?.off_session_consent_at
  } catch (error) {
    console.error('Unable to load automatic top-up settings', error)
    topupFault.value = W.value['topup-load-error']
  }
}

async function buyPack(offer) {
  if (busy.value) return
  busy.value = true
  fault.value = ''
  try {
    await checkout([{ sku: offer.sku, quantity: 1 }])
  } catch (error) {
    console.error('Unable to open usage pack checkout', error)
    fault.value = W.value['purchase-error']
  } finally {
    busy.value = false
  }
}

async function saveTopup() {
  if (busy.value) return
  busy.value = true
  topupFault.value = ''
  topupNotice.value = ''
  try {
    const thresholdUnits = Number(threshold.value)
    const capAmount = Number(monthlyCap.value)
    if (!selectedTopupPack.value || !Number.isFinite(thresholdUnits) || thresholdUnits < 0 ||
        !Number.isFinite(capAmount) || capAmount <= 0) {
      topupFault.value = W.value['settings-invalid']
      return
    }
    await topupRequest({
      action: 'save',
      enabled: topupEnabled.value,
      offer_key: selectedTopupPack.value.key,
      threshold_micros: Math.round(thresholdUnits * 1_000_000),
      monthly_cap_minor: Math.round(capAmount * 100),
      consent: consent.value,
    })
    topupNotice.value = W.value['settings-saved']
  } catch (error) {
    console.error('Unable to save automatic top-up settings', error)
    topupFault.value = error.code === 'payment_method_required'
      ? W.value['payment-method-required']
      : error.code === 'topup_site_disabled'
        ? W.value['topup-site-disabled']
        : W.value['settings-error']
  } finally {
    busy.value = false
  }
}

async function managePayment() {
  if (busy.value) return
  busy.value = true
  topupFault.value = ''
  try {
    const result = await topupRequest({ action: 'portal' })
    if (result.url) window.location.assign(result.url)
  } catch (error) {
    console.error('Unable to open payment settings', error)
    topupFault.value = W.value['payment-settings-error']
  } finally {
    busy.value = false
  }
}

function signIn() {
  window.DLauth?.open()
}

function onAuthChange(event, session) {
  if (event === 'INITIAL_SESSION') return
  if (session?.user) {
    queueMicrotask(() => void load().catch((error) => {
      console.error('Unable to load usage', error)
      state.value = 'error'
      fault.value = W.value['load-error']
    }))
  } else {
    state.value = 'signed-out'
  }
}

onMounted(() => {
  void load().catch((error) => {
    console.error('Unable to load usage', error)
    state.value = 'error'
    fault.value = W.value['load-error']
  })
  const result = supabase.auth.onAuthStateChange(onAuthChange)
  authListener = result.data.subscription
})

onBeforeUnmount(() => authListener?.unsubscribe())
</script>

<template>
  <main class="usage-page lproot lpfull">
    <div class="lpbg"></div>
    <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span><span class="lpblob lpb3"></span></div>
    <div class="lpgrain"></div>
    <div class="usage-shell">
      <header class="usage-head">
        <p class="usage-eyebrow">{{ W.eyebrow }}</p>
        <h1>{{ W.title }}</h1>
        <p class="usage-intro">{{ W.intro }}</p>
      </header>

      <section v-if="state === 'loading'" class="usage-card" role="status">{{ W.loading }}</section>
      <section v-else-if="state === 'signed-out'" class="usage-card usage-signin">
        <p>{{ W['sign-in-copy'] }}</p>
        <button type="button" class="usage-button usage-button-primary" @click="signIn">{{ W['sign-in'] }}</button>
      </section>
      <section v-else-if="state === 'error'" class="usage-card usage-error" role="alert">
        <p>{{ fault }}</p>
        <button type="button" class="usage-button" @click="load">{{ W.retry }}</button>
      </section>
      <template v-else>
        <p v-if="fault" class="usage-alert" role="alert">{{ fault }}</p>

        <section class="usage-section" :aria-label="W['balances-title']">
          <h2>{{ W['balances-title'] }}</h2>
          <p v-if="!balances.length" class="usage-empty">{{ W['balances-empty'] }}</p>
          <div v-else class="usage-balances">
            <article v-for="balance in balances" :key="`${balance.offer_key}:${balance.period_start || 'once'}`" class="usage-card">
              <div class="usage-card-head">
                <h3>{{ titleOf(balance.offer_key) }}</h3>
                <span v-if="balance.period_start" class="usage-period">{{ timeOf(balance.period_start) }}</span>
              </div>
              <p class="usage-remaining">
                {{ W.remaining.replace('{amount}', numberOf(balance.remaining_micros)).replace('{unit}', unitOf(balance.offer_key)) }}
              </p>
              <div class="usage-totals">
                <span>{{ W.used.replace('{amount}', numberOf(balance.used_micros)).replace('{unit}', unitOf(balance.offer_key)) }}</span>
                <span>{{ W.reserved.replace('{amount}', numberOf(balance.reserved_micros)).replace('{unit}', unitOf(balance.offer_key)) }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="usage-section" :aria-label="W['history-title']">
          <h2>{{ W['history-title'] }}</h2>
          <p v-if="!history.length" class="usage-empty">{{ W['history-empty'] }}</p>
          <ol v-else class="usage-history">
            <li v-for="event in history" :key="event.id">
              <div>
                <strong>{{ kindOf(event.kind) }}</strong>
                <span>{{ titleOf(event.offer_key) }}</span>
              </div>
              <span>{{ W.activity.replace('{amount}', numberOf(event.units_micros)).replace('{unit}', unitOf(event.offer_key, event.usage_unit)) }}</span>
              <span v-if="event.seconds_micros">{{ W.seconds.replace('{amount}', numberOf(event.seconds_micros)) }}</span>
              <time :datetime="event.created_at">{{ timeOf(event.created_at) }}</time>
            </li>
          </ol>
        </section>

        <section class="usage-section" :aria-label="W['packs-title']">
          <h2>{{ W['packs-title'] }}</h2>
          <p v-if="!usagePacks.length" class="usage-empty">{{ W['packs-empty'] }}</p>
          <div v-else class="usage-packs">
            <article v-for="offer in usagePacks" :key="offer.key" class="usage-card">
              <div>
                <h3>{{ offer.title }}</h3>
                <p>{{ W.pack-size.replace('{amount}', numberOf(Number(offer.usage.grant) * 1_000_000)).replace('{unit}', offer.usage.unit) }}</p>
              </div>
              <div class="usage-pack-buy">
                <strong>{{ moneyOf(offer.price, offer.currency) }}</strong>
                <button type="button" class="usage-button usage-button-primary" :disabled="busy" @click="buyPack(offer)">
                  {{ busy ? W.opening : W['buy-pack'] }}
                </button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="topupAvailable" class="usage-section usage-topup" :aria-label="W['topup-title']">
          <h2>{{ W['topup-title'] }}</h2>
          <p class="usage-help">{{ W['topup-explanation'] }}</p>
          <p class="usage-help">{{ W['topup-failure-note'] }}</p>
          <p class="usage-payment">{{ hasPaymentMethod ? W['payment-ready'] : W['payment-missing'] }}</p>
          <button type="button" class="usage-button" :disabled="busy" @click="managePayment">{{ W['manage-payment'] }}</button>

          <form class="usage-settings" @submit.prevent="saveTopup">
            <label class="usage-check">
              <input v-model="topupEnabled" type="checkbox" />
              <span>{{ W['topup-enable'] }}</span>
            </label>
            <label>
              <span>{{ W['topup-pack'] }}</span>
              <select v-model="selectedPack" :disabled="busy">
                <option v-for="pack in eligiblePacks" :key="pack.key" :value="pack.key">
                  {{ pack.title }} · {{ moneyOf(Number(pack.unit_amount) / 100, pack.currency) }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ W.threshold.replace('{unit}', selectedTopupPack?.unit || '') }}</span>
              <input v-model="threshold" type="number" min="0" step="0.01" :disabled="busy" />
            </label>
            <label>
              <span>{{ W['monthly-cap'].replace('{currency}', (topupConfig.currency || 'usd').toUpperCase()) }}</span>
              <input v-model="monthlyCap" type="number" min="0.01" step="0.01" :disabled="busy" />
            </label>
            <label class="usage-check">
              <input v-model="consent" type="checkbox" :disabled="busy || !topupEnabled" />
              <span>{{ W['off-session-consent'] }}</span>
            </label>
            <p class="usage-help">{{ W['consent-note'] }}</p>
            <button type="submit" class="usage-button usage-button-primary" :disabled="busy || (topupEnabled && !consent)">
              {{ busy ? W.saving : W['save-settings'] }}
            </button>
          </form>
          <p v-if="topupNotice" class="usage-success" role="status">{{ topupNotice }}</p>
          <p v-if="topupFault" class="usage-alert" role="alert">{{ topupFault }}</p>
        </section>
        <p v-else class="usage-site-disabled">{{ W['topup-unavailable'] }}</p>
      </template>
    </div>
  </main>
</template>

<style scoped>
.usage-page { min-height: 75vh; position: relative; overflow: hidden; color: var(--ink); }
.usage-shell { position: relative; z-index: 1; width: min(100% - 2.5rem, 920px); margin: 0 auto; padding: clamp(3rem, 8vw, 6rem) 0; display: grid; gap: 2.5rem; }
.usage-head { max-width: 42rem; }
.usage-eyebrow { margin: 0 0 .7rem; color: var(--accent2); font: 600 .75rem/1.2 var(--m); letter-spacing: .12em; text-transform: uppercase; }
.usage-head h1 { margin: 0; font: 500 clamp(2.6rem, 7vw, 5rem)/.98 var(--fh); letter-spacing: -.045em; }
.usage-intro { max-width: 34rem; margin: 1rem 0 0; color: var(--ink2); font-size: 1.05rem; line-height: 1.6; }
.usage-section { display: grid; gap: .9rem; min-width: 0; }
.usage-section > h2 { margin: 0; font: 500 1.6rem/1.1 var(--fh); letter-spacing: -.02em; }
.usage-balances, .usage-packs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: .8rem; }
.usage-card { min-width: 0; padding: 1.2rem; border: 1px solid var(--hair); border-radius: 1.1rem; background: color-mix(in srgb, var(--paper) 88%, transparent); box-shadow: 0 18px 40px -36px color-mix(in srgb, var(--ink) 35%, transparent); }
.usage-card-head, .usage-pack-buy { display: flex; justify-content: space-between; align-items: flex-start; gap: .75rem; }
.usage-card h3 { min-width: 0; margin: 0; font-size: 1rem; font-weight: 600; }
.usage-period { color: var(--ink3); font-size: .78rem; }
.usage-remaining { margin: 1.2rem 0 .8rem; font: 500 1.55rem/1.15 var(--fh); font-variant-numeric: tabular-nums; }
.usage-totals { display: flex; flex-wrap: wrap; gap: .5rem 1rem; color: var(--ink3); font-size: .85rem; }
.usage-empty, .usage-help, .usage-site-disabled { margin: 0; color: var(--ink2); line-height: 1.55; }
.usage-history { display: grid; gap: .1rem; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--hair); }
.usage-history li { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(7rem, auto) minmax(6rem, auto) auto; align-items: center; gap: .65rem; padding: .85rem .2rem; border-bottom: 1px solid var(--hair); font-size: .86rem; }
.usage-history li > div { display: grid; gap: .18rem; }
.usage-history li > div span, .usage-history time { color: var(--ink3); }
.usage-history time { text-align: right; font-size: .8rem; }
.usage-packs article { display: flex; flex-direction: column; justify-content: space-between; gap: 1.3rem; }
.usage-packs article p { margin: .4rem 0 0; color: var(--ink3); }
.usage-pack-buy { align-items: center; }
.usage-button { width: fit-content; min-height: 2.65rem; padding: .65rem 1rem; border: 1px solid var(--hair); border-radius: 999px; color: var(--ink); background: var(--paper); font: inherit; cursor: pointer; }
.usage-button:hover { background: var(--accentbg); }
.usage-button:disabled { opacity: .55; cursor: wait; }
.usage-button-primary { border-color: var(--accent); color: var(--paper); background: var(--accent); }
.usage-button-primary:hover { background: var(--accent2); }
.usage-topup { padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--hair); border-radius: 1.2rem; background: color-mix(in srgb, var(--paper) 78%, transparent); }
.usage-payment { margin: .3rem 0 0; color: var(--ink2); font-size: .9rem; }
.usage-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: .6rem; }
.usage-settings label:not(.usage-check) { display: grid; gap: .4rem; color: var(--ink2); font-size: .85rem; }
.usage-settings input:not([type="checkbox"]), .usage-settings select { width: 100%; min-height: 2.7rem; box-sizing: border-box; border: 1px solid var(--hair); border-radius: .7rem; padding: .55rem .7rem; color: var(--ink); background: var(--paper); font: inherit; }
.usage-check { display: flex; align-items: flex-start; gap: .55rem; color: var(--ink2); line-height: 1.45; }
.usage-check input { margin: .2rem 0 0; accent-color: var(--accent); }
.usage-settings .usage-help { grid-column: 1 / -1; font-size: .82rem; }
.usage-success { margin: 0; color: var(--ink2); }
.usage-alert, .usage-error { color: var(--accent2); }
.usage-signin { display: grid; justify-items: start; gap: 1rem; }
.usage-signin p, .usage-error p { margin: 0; }
@media (max-width: 620px) {
  .usage-shell { width: min(100% - 1.5rem, 920px); padding: 2.5rem 0; gap: 2rem; }
  .usage-history li { grid-template-columns: minmax(0, 1fr) auto; }
  .usage-history li > span:nth-child(3) { grid-column: 1; }
  .usage-history time { grid-column: 2; grid-row: 1 / span 3; }
  .usage-settings { grid-template-columns: 1fr; }
}
</style>
