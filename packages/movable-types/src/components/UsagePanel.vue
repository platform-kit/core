<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { checkout } from '@platform-kit/kit/lib/commerce.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { resolveUsageUnit } from '@platform-kit/kit/lib/usage-unit.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { products } from '#content'
import {
  HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE,
  confirmPaymentMethodManagementSession,
  createHyperswitchClient,
  createPaymentMethodManagementWidget,
  loadHyperswitchSdk,
} from '../lib/hyperswitch-sdk.js'
const W = computed(() => ((us('usage').page || {}).main || {}))
const props = defineProps({
  active: { type: Boolean, default: false },
})
const state = ref('loading')
const fault = ref('')
const topupFault = ref('')
const topupNotice = ref('')
const paymentMethodFault = ref('')
const paymentMethodNotice = ref('')
const busy = ref(false)
const balances = ref([])
const history = ref([])
const hasUsageSettings = ref(false)
const topupConfig = ref({ enabled: false, currency: null, packs: [] })
const hasPaymentMethod = ref(false)
const incrementalAttention = ref([])
const activeIncremental = ref(null)
const activePaymentMethod = ref(null)
const incrementalFault = ref('')
const incrementalNotice = ref('')
const canManagePaymentMethod = ref(false)
const topupEnabled = ref(false)
const selectedPack = ref('')
const threshold = ref('1')
const monthlyCap = ref('20')
const consent = ref(false)
let authListener
let stripeScriptPromise

function hyperswitchV2UnavailableMessage(error) {
  return error?.code === HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE
    ? W.value['hyperswitch-v2-browser-unavailable'] ||
      'The secure V2 payment form could not be loaded. No card details were submitted.'
    : ''
}

const usageOffers = computed(() => (products || []).filter((offer) => offer.published !== false && offer.usage))
const usagePacks = computed(() => usageOffers.value.filter((offer) =>
  offer.billing === 'once' && Number(offer.usage?.grant) > 0,
))
const eligiblePacks = computed(() => topupConfig.value.packs || [])
const selectedTopupPack = computed(() =>
  eligiblePacks.value.find((pack) => pack.key === selectedPack.value) || eligiblePacks.value[0] || null,
)
const titleOf = (key) => usageOffers.value.find((offer) => offer.key === key)?.title || W.value.archived
const unitOf = (key, value) => resolveUsageUnit(
  usageOffers.value.find((offer) => offer.key === key)?.usage?.unit,
  value,
)
const numberOf = (micros) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(micros || 0) / 1_000_000)
const moneyOf = (amount, currency = 'usd') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: String(currency || 'usd').toUpperCase(), maximumFractionDigits: 2,
}).format(Number(amount || 0))
const moneyMinorOf = (amountMinor, currency = 'usd') => {
  const code = String(currency || 'usd').toUpperCase()
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
    .resolvedOptions().maximumFractionDigits
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(amountMinor || 0) / (10 ** fractionDigits))
}
const timeOf = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const kindOf = (kind) => W.value[`kind-${kind}`] || W.value['kind-other']
const topupAvailable = computed(() => topupConfig.value.enabled && eligiblePacks.value.length > 0)
const incrementalKey = (settlement) =>
  `${settlement.subscription_id}:${settlement.period_start}:${settlement.settlement_key}`
let loadGeneration = 0

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

async function payoutRequest(body) {
  const { data, error } = await supabase.functions.invoke('payouts', { body })
  if (error) {
    let detail = error.message || ''
    try {
      const payload = await error.context?.clone?.().json()
      detail = payload?.error || detail
    } catch {}
    throw new Error(detail || W.value['request-error'])
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const payoutSetupMode = () =>
  new URLSearchParams(window.location.search).get('payout_setup') === '1'

function payoutReturnTarget(name) {
  const value = new URLSearchParams(window.location.search).get(name) || ''
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  const target = new URL(value, window.location.origin)
  return target.origin === window.location.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : null
}

async function finishPayoutSetup() {
  try {
    const result = await payoutRequest({ action: 'refresh' })
    if (!result?.ready) {
      paymentMethodFault.value = W.value['payout-setup-not-ready']
      return
    }
    const target = payoutReturnTarget('payout_return')
    if (!target) {
      paymentMethodFault.value = W.value['payout-setup-return-error']
      return
    }
    window.location.assign(target)
  } catch (error) {
    console.error('Unable to verify payout setup', error)
    paymentMethodFault.value = W.value['payment-settings-error']
  }
}

function retryPayoutSetup() {
  if (new URLSearchParams(window.location.search).get('payment_method') === 'updated') {
    return finishPayoutSetup()
  }
  return managePayment(true)
}

function cancelPayoutSetup() {
  activePaymentMethod.value = null
  const target = payoutReturnTarget('payout_cancel')
  if (target) {
    window.location.assign(target)
    return
  }
  const url = new URL(window.location.href)
  for (const key of ['payout_setup', 'payout_return', 'payout_cancel', 'payment_method']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState({}, '', url)
}

async function load(retryOnce = true) {
  const generation = ++loadGeneration
  state.value = 'loading'
  fault.value = ''
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    if (authError) throw authError
    if (generation !== loadGeneration) return false
    const user = session?.user
    if (!user) {
      balances.value = []
      history.value = []
      state.value = 'signed-out'
      return false
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
    if (generation !== loadGeneration) return false
    if (balanceResult.error) throw balanceResult.error
    if (historyResult.error) throw historyResult.error
    balances.value = balanceResult.data || []
    history.value = historyResult.data || []
    state.value = 'ready'
    await loadTopup()
    return true
  } catch (error) {
    if (generation !== loadGeneration) return false
    if (retryOnce) {
      console.warn('Usage read failed; retrying once', error)
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (generation !== loadGeneration) return false
      return load(false)
    }
    console.error('Unable to load usage', error)
    state.value = 'error'
    fault.value = W.value['load-error']
    return false
  }
}

function retryIfFailed() {
  if (state.value === 'error') return load()
}

function retryWhenPageActive() {
  if (document.visibilityState === 'visible') void retryIfFailed()
}

watch(() => props.active, (active) => {
  if (active) void retryIfFailed()
}, { immediate: true })
defineExpose({ retryIfFailed })

async function loadTopup() {
  topupFault.value = ''
  try {
    const result = await topupRequest({ action: 'read' })
    topupConfig.value = result.config || { enabled: false, currency: null, packs: [] }
    hasUsageSettings.value = result.preferences != null
    hasPaymentMethod.value = result.has_payment_method === true
    canManagePaymentMethod.value = result.can_manage_payment_method === true
    incrementalAttention.value = Array.isArray(result.incremental_attention) ? result.incremental_attention : []
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

async function loadPaymentSdk(provider, publishableKey, apiBaseUrl, profileId, clientUrl) {
  if (provider === 'stripe') {
    if (!stripeScriptPromise && !window.Stripe) {
      stripeScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://js.stripe.com/v3/'
        script.async = true
        script.onload = resolve
        script.onerror = () => reject(new Error('Stripe.js could not be loaded'))
        document.head.append(script)
      })
    }
    await stripeScriptPromise
    if (typeof window.Stripe !== 'function') throw new Error('Stripe.js did not initialize')
    return { stripe: window.Stripe(publishableKey) }
  }
  if (provider === 'hyperswitch') {
    const Hyper = await loadHyperswitchSdk(clientUrl)
    return { hyper: createHyperswitchClient(Hyper, publishableKey, apiBaseUrl, profileId) }
  }
  throw new Error(`Unsupported payment authentication provider: ${provider}`)
}

async function beginIncrementalPayment(settlement) {
  if (busy.value) return
  busy.value = true
  incrementalFault.value = ''
  incrementalNotice.value = ''
  try {
    const result = await topupRequest({
      action: 'prepare_incremental',
      subscription_id: settlement.subscription_id,
      period_start: settlement.period_start,
      settlement_key: settlement.settlement_key,
    })
    if (result.settled) {
      incrementalNotice.value = W.value['incremental-settled']
      await loadTopup()
      return
    }
    if (result.status) {
      await loadTopup()
      return
    }
    const action = result.action
    if (!action || typeof action.client_secret !== 'string' || typeof action.publishable_key !== 'string') {
      throw new Error('The payment provider did not return customer authentication details')
    }
    activeIncremental.value = {
      settlement,
      action,
      stripe: null,
      hyper: null,
      widgets: null,
      widget: null,
    }
    if (action.provider === 'hyperswitch') {
      const { hyper } = await loadPaymentSdk(
        action.provider,
        action.publishable_key,
        action.api_base_url,
        undefined,
        action.client_url,
      )
      const widgets = hyper.widgets({ clientSecret: action.client_secret })
      const widget = widgets.create('payment', {
        layout: 'accordion',
        wallets: { walletReturnUrl: window.location.href },
      })
      activeIncremental.value = { ...activeIncremental.value, hyper, widgets, widget }
      await nextTick()
      widget.mount('#usage-incremental-payment')
    } else {
      const { stripe } = await loadPaymentSdk(action.provider, action.publishable_key)
      activeIncremental.value = { ...activeIncremental.value, stripe }
    }
  } catch (error) {
    console.error('Unable to prepare incremental usage payment', error)
    incrementalFault.value = hyperswitchV2UnavailableMessage(error) || W.value['incremental-action-error']
  } finally {
    busy.value = false
  }
}

async function completeIncrementalPayment(active) {
  const settlement = active.settlement
  const result = await topupRequest({
    action: 'complete_incremental',
    subscription_id: settlement.subscription_id,
    period_start: settlement.period_start,
    settlement_key: settlement.settlement_key,
  })
  if (!result.settled) throw new Error('The incremental usage payment is not confirmed yet')
  activeIncremental.value = null
  incrementalNotice.value = W.value['incremental-settled']
  await loadTopup()
}

async function confirmIncrementalPayment() {
  const active = activeIncremental.value
  if (busy.value || !active) return
  busy.value = true
  incrementalFault.value = ''
  incrementalNotice.value = ''
  try {
    const { action } = active
    if (action.provider === 'stripe') {
      const result = await active.stripe.confirmCardPayment(action.client_secret, {
        return_url: window.location.href,
      })
      if (result.error) throw result.error
      if (result.paymentIntent?.status === 'succeeded') {
        await completeIncrementalPayment(active)
      } else if (result.paymentIntent?.status === 'processing') {
        activeIncremental.value = null
        await checkIncrementalPayment(active.settlement)
      } else {
        throw new Error('The payment provider has not confirmed the charge')
      }
    } else {
      const result = await active.hyper.confirmPayment({
        widgets: active.widgets,
        confirmParams: { return_url: window.location.href },
        redirect: 'always',
      })
      if (result?.error) throw result.error
      const status = String(result?.status ?? result?.paymentIntent?.status ?? '').toLowerCase()
      if (status === 'succeeded') {
        await completeIncrementalPayment(active)
      } else if (status === 'processing') {
        activeIncremental.value = null
        await checkIncrementalPayment(active.settlement)
      } else {
        throw new Error('The payment provider has not confirmed the charge')
      }
    }
  } catch (error) {
    console.error('Unable to confirm incremental usage payment', error)
    incrementalFault.value = W.value['incremental-action-error']
  } finally {
    busy.value = false
  }
}

async function retryIncrementalPayment(settlement, action = 'retry_incremental') {
  if (busy.value) return
  busy.value = true
  incrementalFault.value = ''
  incrementalNotice.value = ''
  try {
    const result = await topupRequest({
      action,
      subscription_id: settlement.subscription_id,
      period_start: settlement.period_start,
      settlement_key: settlement.settlement_key,
    })
    if (!result.settled) throw new Error('The incremental usage payment is not confirmed yet')
    incrementalNotice.value = W.value['incremental-settled']
    await loadTopup()
  } catch (error) {
    console.error('Unable to reconcile incremental usage payment', { action, error })
    incrementalFault.value = W.value['incremental-action-error']
    await loadTopup()
  } finally {
    busy.value = false
  }
}

async function checkIncrementalPayment(settlement) {
  try {
    const result = await topupRequest({
      action: 'check_incremental',
      subscription_id: settlement.subscription_id,
      period_start: settlement.period_start,
      settlement_key: settlement.settlement_key,
    })
    incrementalNotice.value = result.settled
      ? W.value['incremental-settled']
      : W.value['incremental-processing']
    await loadTopup()
  } catch (error) {
    console.error('Unable to check incremental usage payment', error)
    incrementalFault.value = W.value['incremental-action-error']
    await loadTopup()
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

async function managePayment(forPayout = false) {
  if (busy.value) return
  busy.value = true
  paymentMethodFault.value = ''
  try {
    const returnUrl = new URL(window.location.href)
    returnUrl.searchParams.set('payment_method', 'updated')
    const result = forPayout
      ? await payoutRequest({
          action: 'payout_method_session',
          return_url: returnUrl.toString(),
        })
      : await topupRequest({ action: 'portal' })
    if (result.url) window.location.assign(result.url)
    else if (result.payment_method_management?.provider === 'hyperswitch') {
      const management = result.payment_method_management
      const { hyper } = await loadPaymentSdk(
        'hyperswitch',
        management.publishable_key,
        management.api_base_url,
        management.profile_id,
        management.client_url,
      )
      const { elements, widget } = createPaymentMethodManagementWidget(
        hyper,
        management.sdk_authorization,
      )
      activePaymentMethod.value = { hyper, elements, widget, purpose: forPayout ? 'payout' : 'usage' }
      await nextTick()
      widget.mount('#usage-payment-method-management')
    } else {
      throw new Error('The payment provider did not return a payment-method management session')
    }
  } catch (error) {
    console.error('Unable to open payment settings', error)
    const unavailable = hyperswitchV2UnavailableMessage(error)
    paymentMethodFault.value = unavailable || W.value['payment-settings-error']
    if (incrementalAttention.value.length) {
      incrementalFault.value = unavailable || W.value['payment-settings-error']
    }
  } finally {
    busy.value = false
  }
}

async function confirmPaymentMethodManagement() {
  if (busy.value || !activePaymentMethod.value) return
  busy.value = true
  paymentMethodFault.value = ''
  paymentMethodNotice.value = ''
  try {
    const active = activePaymentMethod.value
    const returnUrl = new URL(window.location.href)
    returnUrl.searchParams.set('payment_method', 'updated')
    await confirmPaymentMethodManagementSession(
      active.hyper,
      active.elements,
      returnUrl.toString(),
    )
    if (active.purpose === 'payout') {
      activePaymentMethod.value = null
      await finishPayoutSetup()
      return
    }
    activePaymentMethod.value = null
    paymentMethodNotice.value = W.value['payment-method-saved']
    await loadTopup()
  } catch (error) {
    console.error('Unable to save payment method', error)
    paymentMethodFault.value = W.value['payment-settings-error']
  } finally {
    busy.value = false
  }
}

function onAuthChange(event, session) {
  if (event === 'INITIAL_SESSION') return
  if (session?.user) {
    queueMicrotask(() => void load())
  } else {
    loadGeneration++
    balances.value = []
    history.value = []
    state.value = 'signed-out'
  }
}

onMounted(() => {
  window.addEventListener('focus', retryWhenPageActive)
  document.addEventListener('visibilitychange', retryWhenPageActive)
  void load().then((loaded) => {
    if (!loaded) return
    const params = new URLSearchParams(window.location.search)
    if (payoutSetupMode() && params.get('payment_method') === 'updated') {
      return finishPayoutSetup()
    }
    if (payoutSetupMode() && state.value === 'ready') {
      return managePayment(true)
    }
    if (params.get('payment_method') === 'updated') {
      paymentMethodNotice.value = W.value['payment-method-saved']
    }
  })
  const result = supabase.auth.onAuthStateChange(onAuthChange)
  authListener = result.data.subscription
})

onBeforeUnmount(() => {
  loadGeneration++
  window.removeEventListener('focus', retryWhenPageActive)
  document.removeEventListener('visibilitychange', retryWhenPageActive)
  authListener?.unsubscribe()
})
</script>

<template>
  <section v-if="state !== 'signed-out'" id="usage" class="usage-panel" :aria-label="W.title">
      <section v-if="state === 'loading'" class="usage-card" role="status">{{ W.loading }}</section>
      <section v-else-if="state === 'error'" class="usage-card usage-error" role="alert">
        <p>{{ fault }}</p>
        <button type="button" class="usage-button" @click="load">{{ W.retry }}</button>
      </section>
      <template v-else-if="state === 'ready'">
        <p v-if="fault" class="usage-alert" role="alert">{{ fault }}</p>

        <p v-if="!balances.length && !history.length" class="usage-empty-state" role="status">
          {{ W['empty-title'] }}
        </p>

        <section v-if="balances.length || history.length" class="usage-section" :aria-label="W['balances-title']">
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

        <section v-if="balances.length || history.length" class="usage-section" :aria-label="W['history-title']">
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

        <section v-if="incrementalAttention.length" class="usage-section usage-incremental" :aria-label="W['incremental-title']">
          <h2>{{ W['incremental-title'] }}</h2>
          <p class="usage-help">{{ W['incremental-explanation'] }}</p>
          <article v-for="settlement in incrementalAttention" :key="incrementalKey(settlement)" class="usage-incremental-card">
            <div class="usage-incremental-summary">
              <div>
                <strong>{{ titleOf(settlement.offer_key) }}</strong>
                <time :datetime="settlement.period_start">{{ timeOf(settlement.period_start) }}</time>
              </div>
              <strong>{{ moneyMinorOf(settlement.amount_minor, settlement.currency) }}</strong>
            </div>
            <p class="usage-period" role="status">
              {{ W[`incremental-status-${settlement.status}`] || W['incremental-status-pending'] }}
            </p>
            <div
              v-if="activeIncremental && incrementalKey(activeIncremental.settlement) === incrementalKey(settlement)"
              class="usage-incremental-action"
            >
              <div v-if="activeIncremental.action.provider === 'hyperswitch'" id="usage-incremental-payment"></div>
              <button type="button" class="usage-button usage-button-primary" :disabled="busy" @click="confirmIncrementalPayment">
                {{ busy ? W['incremental-working'] : W['incremental-confirm'] }}
              </button>
            </div>
            <button
              v-else-if="settlement.status === 'requires_action'"
              type="button"
              class="usage-button usage-button-primary"
              :disabled="busy || (activeIncremental && incrementalKey(activeIncremental.settlement) !== incrementalKey(settlement))"
              @click="beginIncrementalPayment(settlement)"
            >
              {{ W['incremental-continue'] }}
            </button>
            <button
              v-else-if="settlement.status === 'failed'"
              type="button"
              class="usage-button usage-button-primary"
              :disabled="busy"
              @click="retryIncrementalPayment(settlement)"
            >
              {{ busy ? W['incremental-working'] : W['incremental-retry'] }}
            </button>
            <button
              v-if="settlement.status === 'failed' && canManagePaymentMethod"
              type="button"
              class="usage-button"
              :disabled="busy"
              @click="managePayment"
            >
              {{ W['manage-payment'] }}
            </button>
            <button
              v-else-if="settlement.status === 'pending'"
              type="button"
              class="usage-button"
              :disabled="busy"
              @click="retryIncrementalPayment(settlement, 'check_incremental')"
            >
              {{ busy ? W['incremental-working'] : W['incremental-check'] }}
            </button>
          </article>
          <p v-if="incrementalNotice" class="usage-success" role="status">{{ incrementalNotice }}</p>
          <p v-if="incrementalFault" class="usage-alert" role="alert">{{ incrementalFault }}</p>
        </section>
        <p v-if="incrementalNotice && !incrementalAttention.length" class="usage-success" role="status">
          {{ incrementalNotice }}
        </p>
        <p v-if="incrementalFault && !incrementalAttention.length" class="usage-alert" role="alert">
          {{ incrementalFault }}
        </p>

        <section v-if="activePaymentMethod" class="usage-section usage-incremental" :aria-label="W['payment-method-management-title']">
          <h2>{{ activePaymentMethod.purpose === 'payout' ? W['payout-setup-title'] : W['payment-method-management-title'] }}</h2>
          <p class="usage-help">{{ activePaymentMethod.purpose === 'payout' ? W['payout-setup-help'] : W['payment-method-management-help'] }}</p>
          <div id="usage-payment-method-management"></div>
          <div class="usage-incremental-action">
            <button type="button" class="usage-button usage-button-primary" :disabled="busy" @click="confirmPaymentMethodManagement">
              {{ busy ? W['incremental-working'] : W['payment-method-save'] }}
            </button>
            <button type="button" class="usage-button" :disabled="busy" @click="activePaymentMethod.purpose === 'payout' ? cancelPayoutSetup() : activePaymentMethod = null">
              {{ activePaymentMethod.purpose === 'payout' ? W['payout-setup-cancel'] : W['payment-method-cancel'] }}
            </button>
          </div>
          <p v-if="paymentMethodFault" class="usage-alert" role="alert">{{ paymentMethodFault }}</p>
        </section>
        <p v-if="paymentMethodNotice && !activePaymentMethod" class="usage-success" role="status">{{ paymentMethodNotice }}</p>
        <p v-if="paymentMethodFault && !activePaymentMethod" class="usage-alert" role="alert">{{ paymentMethodFault }}</p>
        <div v-if="payoutSetupMode() && !activePaymentMethod" class="usage-incremental-action">
          <button type="button" class="usage-button usage-button-primary" :disabled="busy" @click="retryPayoutSetup">
            {{ busy ? W['incremental-working'] : W['payout-setup-retry'] }}
          </button>
          <button type="button" class="usage-button" :disabled="busy" @click="cancelPayoutSetup">
            {{ W['payout-setup-cancel'] }}
          </button>
        </div>

        <section class="usage-section" :aria-label="W['packs-title']">
          <h2>{{ W['packs-title'] }}</h2>
          <p v-if="!usagePacks.length" class="usage-empty">{{ W['packs-empty'] }}</p>
          <div v-else class="usage-packs">
            <article v-for="offer in usagePacks" :key="offer.key" class="usage-card">
              <div>
                <h3>{{ offer.title }}</h3>
                <p>{{ W.pack-size.replace('{amount}', numberOf(Number(offer.usage.grant) * 1_000_000)).replace('{unit}', unitOf(offer.key)) }}</p>
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
              <span>{{ W.threshold.replace('{unit}', resolveUsageUnit(selectedTopupPack?.unit)) }}</span>
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
  </section>
</template>

<style scoped>
#usage.usage-panel { position: relative; display: grid; gap: clamp(1.5rem, 3vw, 2rem); min-width: 0; margin-top: 0; padding: 0; border: 0; color: var(--ink); }
.usage-panel .usage-section { display: grid; gap: .65rem; min-width: 0; padding: 0; border: 0; }
.usage-section > h2 { margin: 0; color: var(--ink); font-family: var(--f); font-size: 1.25rem; font-weight: 600; line-height: 1.35; letter-spacing: -.015em; }
.usage-balances, .usage-packs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: .8rem; }
.usage-card { min-width: 0; padding: 1.2rem; border: 1px solid var(--hair); border-radius: 1.1rem; background: color-mix(in srgb, var(--paper) 88%, transparent); box-shadow: 0 18px 40px -36px color-mix(in srgb, var(--ink) 35%, transparent); }
.usage-empty-state { max-width: 42rem; margin: 0; padding: .25rem 0 0; color: var(--ink2); font: 500 1rem/1.5 var(--f); }
.usage-card-head, .usage-pack-buy { display: flex; justify-content: space-between; align-items: flex-start; gap: .75rem; }
.usage-card h3 { min-width: 0; margin: 0; font-size: 1rem; font-weight: 600; }
.usage-period { color: var(--ink3); font-size: .78rem; }
.usage-remaining { margin: 1.2rem 0 .8rem; font: 500 1.55rem/1.15 var(--fd); font-variant-numeric: tabular-nums; }
.usage-totals { display: flex; flex-wrap: wrap; gap: .5rem 1rem; color: var(--ink3); font-size: .85rem; }
.usage-empty, .usage-help, .usage-site-disabled { margin: 0; color: var(--ink2); font-size: 1rem; line-height: 1.5; }
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
.usage-button:focus-visible { outline: 2px solid var(--accent2); outline-offset: 3px; }
.usage-button-primary { border-color: var(--ink); color: var(--paper); background: var(--ink); }
.usage-button-primary:hover { border-color: var(--ink2); background: var(--ink2); transform: translateY(-1px); box-shadow: 0 12px 28px -14px color-mix(in srgb, var(--ink) 65%, transparent); }
.usage-topup { padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--hair); border-radius: 1.2rem; background: color-mix(in srgb, var(--paper) 78%, transparent); }
.usage-incremental { padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--hair); border-radius: 1.2rem; background: color-mix(in srgb, var(--paper) 78%, transparent); }
.usage-incremental-card { display: grid; gap: .7rem; min-width: 0; padding: 1rem; border: 1px solid var(--hair); border-radius: .9rem; background: var(--paper); }
.usage-incremental-summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.usage-incremental-summary > div { display: grid; gap: .25rem; min-width: 0; }
.usage-incremental-summary time { color: var(--ink3); font-size: .8rem; }
.usage-incremental-action { display: grid; gap: .8rem; min-width: 0; }
.usage-incremental-action > div { min-width: 0; }
.usage-payment { margin: .3rem 0 0; color: var(--ink2); font-size: .9rem; }
.usage-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: .6rem; }
.usage-settings label:not(.usage-check) { display: grid; gap: .4rem; color: var(--ink2); font-size: .85rem; }
.usage-settings input:not([type="checkbox"]), .usage-settings select { width: 100%; min-height: 2.7rem; box-sizing: border-box; border: 1px solid var(--hair); border-radius: .7rem; padding: .55rem .7rem; color: var(--ink); background: var(--paper); font: inherit; }
.usage-check { display: flex; align-items: flex-start; gap: .55rem; color: var(--ink2); line-height: 1.45; }
.usage-check input { margin: .2rem 0 0; accent-color: var(--accent); }
.usage-settings .usage-help { grid-column: 1 / -1; font-size: .82rem; }
.usage-success { margin: 0; color: var(--ink2); }
.usage-alert, .usage-error { color: var(--accent2); }
.usage-error { width: min(100%, 620px); }
.usage-error p { margin: 0; }
@media (max-width: 620px) {
  .usage-history li { grid-template-columns: minmax(0, 1fr) auto; }
  .usage-history li > span:nth-child(3) { grid-column: 1; }
  .usage-history time { grid-column: 2; grid-row: 1 / span 3; }
  .usage-settings { grid-template-columns: 1fr; }
}
</style>
