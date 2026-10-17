<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ROUTES, navigate } from '../router.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { money } from '@platform-kit/kit/lib/commerce.js'
import { site as SITE_RAW } from '#content'
import {
  HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE,
  confirmV2CheckoutPayment,
  createHyperswitchClient,
  createPaymentMethodManagementWidget,
  loadHyperswitchSdk,
  retrieveV2CheckoutPayment,
} from '../lib/hyperswitch-sdk.js'
import SiteMark from '../components/SiteMark.vue'

const SITE_NAME = ((Array.isArray(SITE_RAW) ? SITE_RAW[0] : SITE_RAW) || {}).name || 'Site'
const state = ref('loading')
const message = ref('')
const checkout = ref(null)
const W = computed(() => us('store').page.head || {})
const title = computed(() => state.value === 'failed'
  ? W.value['checkout-unavailable-title'] || 'Checkout unavailable'
  : W.value['checkout-title'] || 'Complete your payment')
let hyper
let paymentMethodElements
let paymentMethodWidget

watch(title, (value) => setHead({ title: value, description: '', path: ROUTES.hyperswitchCheckout, noindex: true }), { immediate: true })

function checkoutKey(sessionId) {
  return `platformkit:hyperswitch-checkout:${sessionId}`
}

function validSummary(summary) {
  const intervals = ['day', 'week', 'month', 'year']
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) ||
      !['payment', 'subscription'].includes(summary.mode) ||
      typeof summary.currency !== 'string' || !/^[A-Z]{3}$/.test(summary.currency) ||
      !Array.isArray(summary.items) || !summary.items.length ||
      !Number.isSafeInteger(summary.amountTotalMinor) || summary.amountTotalMinor < 0 ||
      !Number.isSafeInteger(summary.amountDueMinor) || summary.amountDueMinor < 0 ||
      summary.amountDueMinor > summary.amountTotalMinor) return false
  const total = summary.items.reduce((sum, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 ||
        !Number.isSafeInteger(item.unitAmountMinor) || item.unitAmountMinor < 0 ||
        !Number.isSafeInteger(item.amountMinor) ||
        item.amountMinor !== item.unitAmountMinor * item.quantity ||
        !['once', 'subscription'].includes(item.billing) ||
        (item.billing === 'subscription' && !intervals.includes(item.interval))) return Number.NaN
    return sum + item.amountMinor
  }, 0)
  return Number.isSafeInteger(total) && total === summary.amountTotalMinor &&
    (summary.trialDays == null ||
      (Number.isSafeInteger(summary.trialDays) && summary.trialDays >= 1 && summary.trialDays <= 365))
}

function validCheckout(value) {
  if (!value || value.provider !== 'hyperswitch' ||
      typeof value.apiBaseUrl !== 'string' ||
      typeof value.publishableKey !== 'string' ||
      typeof value.clientSecret !== 'string' ||
      typeof value.paymentMethodSessionId !== 'string' ||
      typeof value.sdkAuthorization !== 'string' ||
      typeof value.profileId !== 'string' ||
      typeof value.successUrl !== 'string' ||
      typeof value.cancelUrl !== 'string') return false
  try {
    const apiUrl = new URL(value.apiBaseUrl)
    const successUrl = new URL(value.successUrl)
    const cancelUrl = new URL(value.cancelUrl)
    return ['https:', 'http:'].includes(apiUrl.protocol) &&
      ['https:', 'http:'].includes(successUrl.protocol) &&
      ['https:', 'http:'].includes(cancelUrl.protocol) &&
      successUrl.origin === window.location.origin &&
      cancelUrl.origin === window.location.origin &&
      validSummary(value.summary)
  } catch {
    return false
  }
}

function intervalLabel(interval) {
  return W.value[`checkout-interval-${interval}`] || interval
}

function itemTerm(item) {
  if (item.billing !== 'subscription') return W.value['checkout-once'] || 'One-time purchase'
  const cadence = intervalLabel(item.interval || 'month')
  return String(W.value['checkout-frequency'] || 'Billed every {interval}')
    .replace('{interval}', cadence)
}

function safePaymentError(error) {
  const code = String(error?.code || error?.type || '').toLowerCase()
  if (code === 'card_declined' || code === 'payment_method_invalid') {
    return W.value['checkout-declined'] || 'The payment method was declined. Try another payment method or check with your bank.'
  }
  if (code === 'authentication_required' || code === 'requires_action') {
    return W.value['checkout-action-required'] || 'Complete the additional verification in the secure payment form.'
  }
  return W.value['checkout-error'] || 'Your payment could not be completed. Check your details and try again.'
}

async function loadSdk(data) {
  const Hyper = await loadHyperswitchSdk(data.clientUrl)
  return createHyperswitchClient(Hyper, data.publishableKey, data.apiBaseUrl, data.profileId)
}

function paymentReturnUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('payment_action', 'return')
  return url.href
}

async function initialize() {
  const sessionId = new URLSearchParams(window.location.search).get('session') || ''
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(sessionId)) {
    state.value = 'failed'
    message.value = 'This checkout link is invalid or has expired.'
    return
  }
  const stored = sessionStorage.getItem(checkoutKey(sessionId))
  let data
  try {
    data = stored ? JSON.parse(stored) : null
  } catch {
    data = null
  }
  if (!validCheckout(data) || !Number.isFinite(data.expiresAt) || data.expiresAt < Date.now()) {
    sessionStorage.removeItem(checkoutKey(sessionId))
    state.value = 'failed'
    message.value = W.value['checkout-expired'] || 'This checkout has expired. Return to the store to begin again.'
    return
  }
  checkout.value = { ...data, sessionId }
  let returnStatus = ''
  let returnError = null
  if (new URLSearchParams(window.location.search).get('payment_action') === 'return') {
    try {
      returnStatus = await retrieveV2CheckoutPayment({
        apiBaseUrl: data.apiBaseUrl,
        paymentId: sessionId,
        publishableKey: data.publishableKey,
        clientSecret: data.clientSecret,
        profileId: data.profileId,
      })
      if (returnStatus === 'succeeded' || returnStatus === 'processing') {
        finishReturn()
        return
      }
    } catch (error) {
      returnError = error
    } finally {
      const url = new URL(window.location.href)
      url.searchParams.delete('payment_action')
      window.history.replaceState(null, '', url.href)
    }
  }
  try {
    hyper = await loadSdk(data)
    const management = createPaymentMethodManagementWidget(hyper, data.sdkAuthorization)
    paymentMethodElements = management.elements
    paymentMethodWidget = management.widget
    state.value = 'ready'
    await nextTick()
    paymentMethodWidget.mount('#hyperswitch-payment')
    if (returnError || returnStatus) message.value = safePaymentError(returnError || { code: returnStatus })
  } catch (error) {
    state.value = 'failed'
    message.value = error?.code === HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE
      ? W.value['checkout-v2-unavailable'] ||
        'The secure V2 payment form could not be loaded. No card details were submitted and the payment was not confirmed. Return to the store and try again later.'
      : W.value['checkout-error'] || 'Your payment could not be completed. Check your details and try again.'
  }
}

function finishReturn() {
  if (!checkout.value) return
  sessionStorage.removeItem(checkoutKey(checkout.value.sessionId))
  window.location.assign(checkout.value.successUrl)
}

async function submitPayment() {
  if (state.value !== 'ready' || !hyper || !paymentMethodElements || !checkout.value) return
  state.value = 'submitting'
  message.value = ''
  try {
    const result = await confirmV2CheckoutPayment({
      hyper,
      elements: paymentMethodElements,
      returnUrl: paymentReturnUrl(),
      apiBaseUrl: checkout.value.apiBaseUrl,
      paymentId: checkout.value.sessionId,
      publishableKey: checkout.value.publishableKey,
      clientSecret: checkout.value.clientSecret,
      profileId: checkout.value.profileId,
    })
    if (result.redirectUrl) {
      window.location.assign(result.redirectUrl)
      return
    }
    if (result.status === 'succeeded' || result.status === 'processing') {
      finishReturn()
      return
    }
    message.value = safePaymentError({ code: result.status })
    state.value = 'ready'
  } catch (error) {
    message.value = safePaymentError(error)
    state.value = 'ready'
  }
}

function cancel() {
  if (checkout.value) sessionStorage.removeItem(checkoutKey(checkout.value.sessionId))
  if (checkout.value?.cancelUrl) window.location.assign(checkout.value.cancelUrl)
  else navigate(ROUTES.store)
}

onMounted(initialize)
</script>

<template>
  <div class="hs-checkout lproot">
    <header class="hs-checkout-bar">
      <div class="hs-checkout-bar-in">
        <a :href="ROUTES.home" class="hs-checkout-home" @click.prevent="navigate(ROUTES.home)">
          <SiteMark class="hs-checkout-mark" />
          <span class="hs-checkout-brand">{{ SITE_NAME }}</span>
        </a>
        <span class="hs-checkout-secure">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="4.5" y="8.5" width="11" height="9" rx="2" />
            <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" stroke-linecap="round" />
          </svg>
          {{ W['checkout-secure'] || 'Secure checkout' }}
        </span>
      </div>
    </header>
    <main class="hs-checkout-main" :class="{ 'hs-checkout-main-failed': state === 'failed' }">
      <div class="hs-checkout-intro">
        <h1>{{ title }}</h1>
        <p v-if="state !== 'failed'" class="hs-checkout-lead">{{ W['checkout-subtitle'] || 'Your payment details are entered securely with the payment provider.' }}</p>
      </div>
      <div v-if="state === 'loading'" class="hs-checkout-status" role="status">
        {{ W['checkout-loading'] || 'Loading secure payment form…' }}
      </div>
      <section v-if="checkout" class="hs-checkout-summary" :aria-label="W['checkout-summary'] || 'Order summary'">
        <h2>{{ W['checkout-summary'] || 'Order summary' }}</h2>
        <ul>
          <li v-for="(item, index) in checkout.summary.items" :key="`${item.name}:${index}`">
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.quantity }} × {{ money(item.unitAmountMinor, checkout.summary.currency) }} · {{ itemTerm(item) }}</small>
            </div>
            <span>{{ money(item.amountMinor, checkout.summary.currency) }}</span>
          </li>
        </ul>
        <div class="hs-checkout-total">
          <span>{{ W['checkout-total'] || 'Due now' }}</span>
          <strong>{{ money(checkout.summary.amountDueMinor, checkout.summary.currency) }}</strong>
        </div>
        <p v-if="checkout.summary.mode === 'subscription' && checkout.summary.trialDays">
          {{ String(W['checkout-trial'] || '{n} days free').replace('{n}', checkout.summary.trialDays) }}.
          {{ String(W['checkout-recurring'] || 'Then {price} every {interval}')
            .replace('{price}', money(checkout.summary.amountTotalMinor, checkout.summary.currency))
            .replace('{interval}', intervalLabel(checkout.summary.items[0]?.interval || 'month')) }}
        </p>
        <p v-else-if="checkout.summary.mode === 'subscription'">
          {{ String(W['checkout-frequency'] || 'Billed every {interval}')
            .replace('{interval}', intervalLabel(checkout.summary.items[0]?.interval || 'month')) }}
        </p>
      </section>
      <div v-if="state !== 'loading' && state !== 'failed'" class="hs-checkout-payment">
        <div id="hyperswitch-payment" class="hs-checkout-widget" />
        <p v-if="message" class="hs-checkout-error" role="alert">{{ message }}</p>
        <button class="lpbtn" type="button" :disabled="state === 'submitting'" @click="submitPayment">
          {{ state === 'submitting' ? (W['checkout-submitting'] || 'Confirming…') : (W['checkout-submit'] || 'Pay securely') }}
        </button>
      </div>
      <section v-if="state === 'failed'" class="hs-checkout-failure" role="alert">
        <p>{{ message }}</p>
        <button class="lpbtn" type="button" @click="cancel">{{ W['checkout-return'] || 'Return to the store' }}</button>
      </section>
      <button v-else class="hs-checkout-cancel" type="button" @click="cancel">{{ W['checkout-cancel'] || 'Cancel and return' }}</button>
    </main>
  </div>
</template>

<style scoped>
.hs-checkout { min-height: 100vh; background: var(--paper); color: var(--ink) }
.hs-checkout-bar { padding: 0; border-bottom: 1px solid var(--hair); font-size: 14px; color: var(--ink3) }
.hs-checkout-bar-in { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: min(1040px, 100%); min-height: 64px; margin: 0 auto; padding: 0 20px; box-sizing: border-box }
.hs-checkout-home { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none }
.hs-checkout-mark { width: 22px; height: 22px }
.hs-checkout-brand { color: var(--ink); font-weight: 600 }
.hs-checkout-secure { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--hair); border-radius: 999px; white-space: nowrap }
.hs-checkout-main { width: min(1040px, 100%); margin: 0 auto; padding: clamp(24px, 5vw, 52px) 20px; display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); align-items: start; gap: 20px 32px }
.hs-checkout-main-failed { width: min(640px, 100%); min-height: calc(100vh - 64px); min-height: calc(100svh - 64px); grid-template-columns: minmax(0, 1fr); align-content: center }
.hs-checkout-intro { grid-column: 1 / -1; display: grid; gap: 8px }
.hs-checkout-main-failed .hs-checkout-intro { grid-column: auto }
.hs-checkout-main h1 { font-size: clamp(25px, 5vw, 36px); margin: 0; max-width: none }
.hs-checkout-lead { color: var(--ink2); margin: 0; line-height: 1.5 }
.hs-checkout-summary, .hs-checkout-payment { min-width: 0; border: 1px solid var(--hair); border-radius: 14px; padding: clamp(16px, 3vw, 24px); background: var(--paper2, var(--paper)) }
.hs-checkout-summary h2 { margin: 0 0 14px; font-size: 18px }
.hs-checkout-summary ul { display: grid; gap: 14px; list-style: none; padding: 0; margin: 0 }
.hs-checkout-summary li { display: flex; justify-content: space-between; gap: 16px; align-items: start }
.hs-checkout-summary li div { display: grid; gap: 4px }
.hs-checkout-summary li strong, .hs-checkout-summary li > span { font-size: 14px }
.hs-checkout-summary small, .hs-checkout-summary p { color: var(--ink2); font-size: 12px; line-height: 1.5 }
.hs-checkout-summary p { margin: 14px 0 0 }
.hs-checkout-total { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid var(--hair); padding-top: 14px; margin-top: 18px; font-size: 14px }
.hs-checkout-widget { min-height: 180px }
.hs-checkout-payment { display: grid; gap: 16px }
.hs-checkout-failure { display: grid; gap: 18px; min-width: 0; padding: clamp(18px, 4vw, 28px); border: 1px solid var(--hair); border-radius: 16px; background: var(--paper2, var(--paper)); box-shadow: 0 16px 38px -32px color-mix(in srgb, var(--ink) 35%, transparent) }
.hs-checkout-failure p { margin: 0; color: var(--ink2); line-height: 1.55 }
.hs-checkout-failure .lpbtn { display: flex; justify-content: center; width: 100% }
.hs-checkout-error { color: var(--danger, #a32222); margin: 0; line-height: 1.5 }
.hs-checkout-status { grid-column: 1 / -1; color: var(--ink2); padding: 24px 0 }
.hs-checkout-cancel { grid-column: 1 / -1; justify-self: center; border: 0; background: none; color: var(--ink2); text-decoration: underline; cursor: pointer; font: inherit; padding: 8px }
.lpbtn:disabled { cursor: wait; opacity: .65 }
@media (max-width: 760px) { .hs-checkout-main { grid-template-columns: minmax(0, 1fr); gap: 16px } .hs-checkout-intro, .hs-checkout-status, .hs-checkout-cancel { grid-column: auto } }
</style>
